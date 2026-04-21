"""
Persistent Queue — Crash-proof JSON-backed job queue.
Survives server restarts. All state is atomically persisted to disk.
"""
import json
import os
import threading
import time
import uuid
from datetime import datetime

QUEUE_FILE = "queue_state.json"
MAX_RETRIES = 3


class PersistentQueue:
    """Thread-safe, JSON-backed persistent job queue."""
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        # [H1] Fixed: guard both creation AND initialization under the same lock
        with cls._lock:
            if cls._instance is None:
                inst = super().__new__(cls)
                inst._initialized = False
                inst._jobs = {}
                inst._file_lock = threading.Lock()
                inst._load_initial()
                inst._initialized = True
                cls._instance = inst
        return cls._instance

    def __init__(self):
        # All initialization is done in __new__ under the lock
        pass

    def _load_initial(self):
        """Load queue state from disk (called once during singleton creation)."""
        try:
            if os.path.exists(QUEUE_FILE):
                with open(QUEUE_FILE, "r") as f:
                    data = json.load(f)
                self._jobs = data.get("jobs", {})
                print(f"\U0001f4cb Loaded {len(self._jobs)} jobs from persistent queue")
            else:
                self._jobs = {}
        except Exception as e:
            print(f"\u26a0\ufe0f Failed to load queue state: {e}")
            self._jobs = {}



    def _save(self):
        """Atomically persist queue state to disk. [H3] Uses fsync for durability."""
        try:
            tmp_file = QUEUE_FILE + ".tmp"
            data = {"jobs": self._jobs, "saved_at": datetime.now().isoformat()}
            with open(tmp_file, "w") as f:
                json.dump(data, f, indent=2, default=str)
                f.flush()
                os.fsync(f.fileno())  # [H3] Ensure data is on disk before rename
            os.replace(tmp_file, QUEUE_FILE)  # Atomic rename
        except Exception as e:
            print(f"\u26a0\ufe0f Failed to save queue state: {e}")

    def add_job(self, chat_id, message_id, file_name, file_size=0, source_channel="", clean_name=None, media_type=None):
        """Add a new download job to the persistent queue."""
        # [L4] Use 12-char UUID for lower collision probability
        job_id = str(uuid.uuid4())[:12]
        job = {
            "id": job_id,
            "chat_id": chat_id,
            "message_id": message_id,
            "file_name": file_name,
            "clean_name": clean_name or file_name,
            "media_type": media_type or "unknown",
            "file_size": file_size,
            "source_channel": source_channel,
            "status": "queued",        # queued → downloading → uploading → completed / failed
            "progress": 0,
            "speed": 0,
            "phase": "Waiting in queue",
            "error": None,
            "retry_count": 0,
            "gdrive_file_id": None,
            "resumable_uri": None,     # For resuming GDrive uploads after crash
            "uploaded_bytes": 0,
            "created_at": datetime.now().isoformat(),
            "started_at": None,
            "completed_at": None,
        }
        with self._file_lock:
            self._jobs[job_id] = job
            self._save()
        return job

    def get_next_pending(self):
        """Get the next queued job (FIFO by created_at). Returns None if empty."""
        with self._file_lock:
            pending = [
                j for j in self._jobs.values()
                if j["status"] == "queued"
            ]
            if not pending:
                return None
            # Sort by creation time (oldest first)
            pending.sort(key=lambda x: x.get("created_at", ""))
            job = pending[0]
            job["status"] = "downloading"
            job["started_at"] = datetime.now().isoformat()
            job["phase"] = "Starting download"
            self._save()
            return job

    def update_job(self, job_id, persist=True, **kwargs):
        """Update specific fields of a job. Set persist=False for high-frequency progress updates."""
        with self._file_lock:
            if job_id in self._jobs:
                self._jobs[job_id].update(kwargs)
                if persist:
                    self._save()

    def mark_complete(self, job_id, gdrive_file_id=None):
        """Mark a job as successfully completed."""
        with self._file_lock:
            if job_id in self._jobs:
                self._jobs[job_id].update({
                    "status": "completed",
                    "progress": 100,
                    "phase": "Done",
                    "gdrive_file_id": gdrive_file_id,
                    "completed_at": datetime.now().isoformat(),
                })
                self._save()

    def mark_failed(self, job_id, error_msg):
        """Mark a job as failed. Auto-requeue if retries remain."""
        with self._file_lock:
            if job_id not in self._jobs:
                return False
            job = self._jobs[job_id]
            job["retry_count"] = job.get("retry_count", 0) + 1

            if job["retry_count"] < MAX_RETRIES:
                # Requeue for retry
                job["status"] = "queued"
                job["phase"] = f"Retry #{job['retry_count']} — {error_msg[:100]}"
                job["error"] = error_msg
                job["progress"] = 0
                self._save()
                return True  # Will be retried
            else:
                # Permanent failure
                job["status"] = "failed"
                job["phase"] = "Permanently failed"
                job["error"] = error_msg
                job["completed_at"] = datetime.now().isoformat()
                self._save()
                return False  # Won't retry

    def recover_interrupted(self):
        """Called on startup: reset any in-progress jobs back to queued."""
        recovered = 0
        permanently_failed = 0
        with self._file_lock:
            for job in self._jobs.values():
                if job["status"] in ("downloading", "uploading"):
                    job["retry_count"] = job.get("retry_count", 0) + 1
                    # [CR2-M6] Cap retries — don't infinitely re-queue toxic jobs
                    if job["retry_count"] >= MAX_RETRIES:
                        job["status"] = "failed"
                        job["phase"] = "Permanently failed (max retries after restarts)"
                        job["error"] = "Exceeded maximum retry count across server restarts"
                        job["completed_at"] = datetime.now().isoformat()
                        permanently_failed += 1
                    else:
                        job["status"] = "queued"
                        job["phase"] = "Recovered after restart"
                        job["progress"] = 0
                        recovered += 1
            if recovered or permanently_failed:
                self._save()
        if recovered:
            print(f"🔄 Recovered {recovered} interrupted jobs after restart")
        if permanently_failed:
            print(f"❌ {permanently_failed} jobs permanently failed (exceeded {MAX_RETRIES} retries)")
        return recovered

    def get_job(self, job_id):
        """Get a single job by ID."""
        return self._jobs.get(job_id)

    def get_all(self):
        """Get all jobs grouped by status."""
        result = {
            "queued": [],
            "downloading": [],
            "uploading": [],
            "completed": [],
            "failed": [],
        }
        for job in self._jobs.values():
            status = job.get("status", "queued")
            if status in result:
                result[status].append(job)
        # Sort each group
        for key in result:
            result[key].sort(key=lambda x: x.get("created_at", ""), reverse=(key in ("completed", "failed")))
        return result

    def get_stats(self):
        """Quick stats for the dashboard."""
        all_jobs = list(self._jobs.values())
        return {
            "total": len(all_jobs),
            "queued": sum(1 for j in all_jobs if j["status"] == "queued"),
            "active": sum(1 for j in all_jobs if j["status"] in ("downloading", "uploading")),
            "completed": sum(1 for j in all_jobs if j["status"] == "completed"),
            "failed": sum(1 for j in all_jobs if j["status"] == "failed"),
        }

    def retry_job(self, job_id):
        """Manually retry a failed job."""
        with self._file_lock:
            if job_id in self._jobs and self._jobs[job_id]["status"] == "failed":
                self._jobs[job_id]["status"] = "queued"
                self._jobs[job_id]["phase"] = "Manual retry"
                self._jobs[job_id]["error"] = None
                self._jobs[job_id]["retry_count"] = 0
                self._jobs[job_id]["progress"] = 0
                self._save()
                return True
        return False

    def clear_finished(self):
        """Remove all completed and failed jobs from the queue."""
        with self._file_lock:
            to_remove = [
                jid for jid, j in self._jobs.items()
                if j["status"] in ("completed", "failed")
            ]
            for jid in to_remove:
                del self._jobs[jid]
            self._save()
            return len(to_remove)

    def pending_count(self):
        """Number of jobs waiting to be processed."""
        return sum(1 for j in self._jobs.values() if j["status"] == "queued")
