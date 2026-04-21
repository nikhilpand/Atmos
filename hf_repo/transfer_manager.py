"""
Transfer Manager — Central state store for all transfers.
Tracks active downloads, uploads, history, errors, and speed metrics.
Thread-safe for concurrent use by Telegram bot and Gradio UI.
"""
import threading
import time
import uuid
import os
from datetime import datetime
from collections import deque

class Transfer:
    """Represents a single download-to-upload transfer job."""
    def __init__(self, source, filename, source_type="url"):
        self.id = str(uuid.uuid4())[:8]
        self.source = source            # URL or Telegram chat info
        self.filename = filename
        self.source_type = source_type  # "url", "telegram_document", "telegram_video"
        self.status = "queued"          # queued, downloading, uploading, completed, failed
        self.progress = 0               # 0-100
        self.phase = ""                 # "Downloading from Telegram", "Uploading to GDrive", etc.
        self.file_size = 0              # bytes
        self.downloaded_bytes = 0
        self.uploaded_bytes = 0
        self.speed = 0                  # bytes per second
        self.gdrive_file_id = None
        self.error = None
        self.created_at = datetime.now()
        self.completed_at = None
        self._start_time = None
        self._phase_bytes_start = 0
        self.meta = {}

    def start_phase(self, phase_name):
        self.phase = phase_name
        self._start_time = time.time()
        self._phase_bytes_start = 0

    def update_progress(self, current_bytes, total_bytes):
        self.file_size = total_bytes
        elapsed = time.time() - self._start_time if self._start_time else 1
        if elapsed > 0:
            self.speed = (current_bytes - self._phase_bytes_start) / elapsed
        if total_bytes > 0:
            self.progress = int((current_bytes / total_bytes) * 100)
        if self.status == "downloading":
            self.downloaded_bytes = current_bytes
        elif self.status == "uploading":
            self.uploaded_bytes = current_bytes

    def complete(self, gdrive_file_id=None):
        self.status = "completed"
        self.progress = 100
        self.phase = "Done"
        self.gdrive_file_id = gdrive_file_id
        self.completed_at = datetime.now()

    def fail(self, error_msg):
        self.status = "failed"
        self.phase = "Error"
        self.error = str(error_msg)
        self.completed_at = datetime.now()

    def to_dict(self):
        return {
            "id": self.id,
            "source": self.source[:80] if self.source else "",
            "filename": self.filename,
            "source_type": self.source_type,
            "status": self.status,
            "progress": self.progress,
            "phase": self.phase,
            "file_size": self.file_size,
            "speed": self.speed,
            "gdrive_file_id": self.gdrive_file_id or "",
            "error": self.error or "",
            "created_at": self.created_at.strftime("%Y-%m-%d %H:%M:%S"),
            "completed_at": self.completed_at.strftime("%Y-%m-%d %H:%M:%S") if self.completed_at else "",
            "duration": str(self.completed_at - self.created_at).split(".")[0] if self.completed_at else "",
            "meta": self.meta,
        }


class TransferManager:
    """Thread-safe singleton managing all transfer state."""
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self._transfers = {}           # id -> Transfer
        self._history = deque(maxlen=100)  # last 100 completed
        self._errors = deque(maxlen=50)
        self._data_lock = threading.Lock()  # [CR2-H3] Renamed to avoid shadowing cls._lock
        self._total_bytes_transferred = 0
        self._total_files_transferred = 0
        self._start_time = datetime.now()

    def create_transfer(self, source, filename, source_type="url"):
        t = Transfer(source, filename, source_type)
        with self._data_lock:
            self._evict_stale()  # [H2] Clean up before adding
            self._transfers[t.id] = t
        return t

    def _evict_stale(self):
        """[H2] Remove transfers older than 2 hours that are stuck (not completed/failed)."""
        now = time.time()
        stale_ids = []
        for tid, t in self._transfers.items():
            age = now - t.created_at.timestamp()
            if age > 7200 and t.status not in ("completed", "failed"):
                stale_ids.append(tid)
            elif t.status in ("completed", "failed") and age > 3600:
                stale_ids.append(tid)  # Also evict finished transfers after 1hr
        for tid in stale_ids:
            self._transfers.pop(tid, None)

    def get_transfer(self, transfer_id):
        return self._transfers.get(transfer_id)

    def complete_transfer(self, transfer_id, gdrive_file_id=None):
        with self._data_lock:
            t = self._transfers.get(transfer_id)
            if t:
                t.complete(gdrive_file_id)
                self._total_bytes_transferred += t.file_size
                self._total_files_transferred += 1
                self._history.appendleft(t.to_dict())
                del self._transfers[transfer_id]

    def fail_transfer(self, transfer_id, error_msg):
        with self._data_lock:
            t = self._transfers.get(transfer_id)
            if t:
                t.fail(error_msg)
                self._errors.appendleft(t.to_dict())
                self._history.appendleft(t.to_dict())
                del self._transfers[transfer_id]

    def get_active_transfers(self):
        with self._data_lock:
            return [t.to_dict() for t in self._transfers.values()]

    def get_history(self, limit=20):
        return list(self._history)[:limit]

    def get_errors(self, limit=20):
        return list(self._errors)[:limit]

    def get_stats(self):
        uptime = datetime.now() - self._start_time
        hours = int(uptime.total_seconds() // 3600)
        minutes = int((uptime.total_seconds() % 3600) // 60)
        return {
            "total_files": self._total_files_transferred,
            "total_bytes": self._total_bytes_transferred,
            "total_size_human": _human_size(self._total_bytes_transferred),
            "active_transfers": len(self._transfers),
            "total_errors": len(self._errors),
            "uptime": f"{hours}h {minutes}m",
            "server_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }


def _human_size(num_bytes):
    """Convert bytes to human-readable string."""
    num_bytes = num_bytes or 0  # [CR2-L2] Guard against None
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if abs(num_bytes) < 1024.0:
            return f"{num_bytes:.1f} {unit}"
        num_bytes /= 1024.0
    return f"{num_bytes:.1f} PB"
