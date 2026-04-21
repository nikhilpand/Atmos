"""
ATMOS Download Manager — Local Server
Runs at http://localhost:8765

Downloads via yt-dlp / aria2c and auto-uploads to Google Drive.
Uses the same gdrive_uploader.py as the HF backend.

Usage: python3 downloader_server.py
"""

import os
import sys
import json
import uuid
import asyncio
import subprocess
import threading
import time
import shutil
import re
from pathlib import Path
from typing import Optional

# Add hf_repo to path for shared modules

from fastapi import FastAPI, BackgroundTasks
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

import uvicorn
from dotenv import load_dotenv

load_dotenv()

# ─── Config ──────────────────────────────────────────────────────────
DOWNLOAD_DIR = Path(__file__).parent / "downloads"
DOWNLOAD_DIR.mkdir(exist_ok=True)

GDRIVE_CREDENTIALS = os.environ.get("GDRIVE_CREDENTIALS", "")
GDRIVE_FOLDER_ID   = os.environ.get("GDRIVE_FOLDER_ID", "")
TMDB_API_KEY       = os.environ.get("TMDB_API_KEY", "")
ATMOS_URL          = "https://atmos.page.gd"   # or localhost:3000

# ─── Job Store ───────────────────────────────────────────────────────
jobs: dict[str, dict] = {}   # job_id → job dict
jobs_lock = threading.Lock()

def new_job(url: str, title: str = "") -> str:
    jid = uuid.uuid4().hex[:8]
    with jobs_lock:
        jobs[jid] = {
            "id": jid,
            "url": url,
            "title": title or url,
            "status": "queued",      # queued | downloading | uploading | done | error
            "phase": "Waiting...",
            "progress": 0,           # 0-100
            "speed": "",
            "eta": "",
            "size": "",
            "file_path": "",
            "drive_id": "",
            "error": "",
            "created": time.time(),
        }
    return jid

def update_job(jid: str, **kwargs):
    with jobs_lock:
        if jid in jobs:
            jobs[jid].update(kwargs)

# ─── FastAPI App ─────────────────────────────────────────────────────
app = FastAPI(title="ATMOS Downloader")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ─── API endpoints ───────────────────────────────────────────

# ─── TMDB Search ─────────────────────────────────────────────────────
@app.get("/api/search")
async def search(q: str):
    if not TMDB_API_KEY:
        return JSONResponse({"error": "TMDB_API_KEY not set in .env"}, status_code=500)
    import urllib.request, urllib.parse
    query = urllib.parse.quote(q)
    url = f"https://api.themoviedb.org/3/search/multi?api_key={TMDB_API_KEY}&query={query}&include_adult=false"
    with urllib.request.urlopen(url, timeout=8) as r:
        data = json.loads(r.read())
    results = []
    for item in data.get("results", [])[:12]:
        media_type = item.get("media_type", "movie")
        if media_type not in ("movie", "tv"):
            continue
        results.append({
            "id": item["id"],
            "title": item.get("title") or item.get("name", ""),
            "year": (item.get("release_date") or item.get("first_air_date") or "")[:4],
            "type": media_type,
            "overview": item.get("overview", "")[:120],
            "poster": f"https://image.tmdb.org/t/p/w185{item['poster_path']}" if item.get("poster_path") else "",
            "rating": round(item.get("vote_average", 0), 1),
        })
    return results

# ─── Submit Download ─────────────────────────────────────────────────
@app.post("/api/download")
async def submit_download(body: dict, background_tasks: BackgroundTasks):
    url   = (body.get("url") or "").strip()
    title = (body.get("title") or "").strip()
    if not url:
        return JSONResponse({"error": "url is required"}, status_code=400)

    jid = new_job(url, title)
    background_tasks.add_task(run_download_job, jid)
    return {"job_id": jid}

# ─── Job Status ──────────────────────────────────────────────────────
@app.get("/api/jobs")
async def list_jobs():
    with jobs_lock:
        return sorted(jobs.values(), key=lambda j: j["created"], reverse=True)

@app.get("/api/jobs/{jid}")
async def get_job(jid: str):
    with jobs_lock:
        job = jobs.get(jid)
    if not job:
        return JSONResponse({"error": "not found"}, status_code=404)
    return job

@app.delete("/api/jobs/{jid}")
async def delete_job(jid: str):
    with jobs_lock:
        jobs.pop(jid, None)
    return {"ok": True}

# ─── SSE live progress stream ─────────────────────────────────────────
@app.get("/api/jobs/{jid}/stream")
async def job_stream(jid: str):
    async def event_gen():
        last = {}
        for _ in range(600):   # max 10 min poll
            with jobs_lock:
                job = dict(jobs.get(jid, {}))
            if job != last:
                yield f"data: {json.dumps(job)}\n\n"
                last = job
            if job.get("status") in ("done", "error"):
                return
            await asyncio.sleep(0.8)
    return StreamingResponse(event_gen(), media_type="text/event-stream")

# ─── Download + Upload Worker ─────────────────────────────────────────
def run_download_job(jid: str):
    """Runs in a thread: download → upload to GDrive → cleanup"""
    job = jobs.get(jid, {})
    url = job["url"]
    title = job["title"]

    # ── 1. Download ──
    update_job(jid, status="downloading", phase="Starting download...")

    out_path = DOWNLOAD_DIR / jid
    out_path.mkdir(exist_ok=True)
    final_file = None

    try:
        if _is_magnet_or_torrent(url):
            final_file = _download_torrent(jid, url, out_path)
        else:
            final_file = _download_ytdlp(jid, url, out_path, title)
    except Exception as e:
        update_job(jid, status="error", error=str(e))
        return

    if not final_file or not final_file.exists():
        update_job(jid, status="error", error="Download produced no output file")
        return

    update_job(jid, file_path=str(final_file), phase="Download complete, uploading to Drive...")

    # ── 2. Upload to GDrive ──
    if not GDRIVE_CREDENTIALS:
        update_job(jid, status="error", error="GDRIVE_CREDENTIALS not set in .env")
        return

    try:
        update_job(jid, status="uploading", progress=0)
        from gdrive_uploader import get_drive_service, upload_file_to_drive
        service = get_drive_service(GDRIVE_CREDENTIALS)
        display_name = _clean_filename(title or final_file.name) if title else final_file.name
        file_id = upload_file_to_drive(
            service,
            str(final_file),
            folder_id=GDRIVE_FOLDER_ID or None,
            display_name=display_name,
        )
        update_job(jid, drive_id=file_id, status="done", progress=100,
                   phase=f"✅ Uploaded to Drive: {display_name}")
    except Exception as e:
        update_job(jid, status="error", error=f"Upload failed: {e}")
        return
    finally:
        # Clean up local download
        try:
            shutil.rmtree(out_path, ignore_errors=True)
        except Exception:
            pass


def _is_magnet_or_torrent(url: str) -> bool:
    return url.startswith("magnet:") or url.endswith(".torrent")


def _download_ytdlp(jid: str, url: str, out_dir: Path, title: str = "") -> Optional[Path]:
    """Downloads using yt-dlp with real-time progress reporting."""
    out_tmpl = str(out_dir / "%(title)s.%(ext)s")
    cmd = [
        "yt-dlp",
        "--no-playlist",
        "--merge-output-format", "mkv",
        "--format", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best",
        "--output", out_tmpl,
        "--newline",           # one line per progress update
        "--no-colors",
        url,
    ]

    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, bufsize=1
    )

    for line in proc.stdout:
        line = line.strip()
        # Parse yt-dlp progress: [download]  45.3% of  1.23GiB at  5.12MiB/s ETA 02:34
        m = re.search(r'\[download\]\s+([\d.]+)%\s+of\s+([\S]+)\s+at\s+([\S]+)\s+ETA\s+(\S+)', line)
        if m:
            pct  = float(m.group(1))
            size = m.group(2)
            spd  = m.group(3)
            eta  = m.group(4)
            update_job(jid, progress=pct, size=size, speed=spd, eta=eta,
                       phase=f"Downloading {pct:.1f}% · {spd}/s · ETA {eta}")

    proc.wait()
    if proc.returncode != 0:
        raise RuntimeError(f"yt-dlp exited with code {proc.returncode}")

    # Find the downloaded file
    files = list(out_dir.iterdir())
    if not files:
        raise RuntimeError("yt-dlp finished but no file found")
    return max(files, key=lambda f: f.stat().st_size)


def _download_torrent(jid: str, url: str, out_dir: Path) -> Optional[Path]:
    """Downloads a magnet link using aria2c."""
    if not shutil.which("aria2c"):
        raise RuntimeError("aria2c is not installed. Run: sudo apt install aria2")

    cmd = [
        "aria2c",
        "--dir", str(out_dir),
        "--seed-time=0",            # don't seed
        "--bt-stop-timeout=30",
        "--max-connection-per-server=16",
        "--split=16",
        "--min-split-size=5M",
        "--console-log-level=notice",
        url,
    ]

    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, bufsize=1
    )

    for line in proc.stdout:
        # aria2c progress: [#abc123 1.2GiB/4.5GiB(27%) CN:8 DL:12.3MiB ETA:3m]
        m = re.search(r'\((\d+)%\).*DL:([\d.]+\w+).*ETA:(\S+)', line)
        if m:
            pct = float(m.group(1))
            spd = m.group(2) + "/s"
            eta = m.group(3)
            update_job(jid, progress=pct, speed=spd, eta=eta,
                       phase=f"Downloading {pct:.0f}% · {spd} · ETA {eta}")

    proc.wait()
    if proc.returncode != 0:
        raise RuntimeError(f"aria2c exited with code {proc.returncode}")

    # Find the largest video file
    video_exts = {".mkv", ".mp4", ".avi", ".mov", ".m4v", ".webm"}
    files = [f for f in out_dir.rglob("*") if f.suffix.lower() in video_exts]
    if not files:
        files = list(out_dir.rglob("*.*"))
    if not files:
        raise RuntimeError("aria2c finished but no file found")
    return max(files, key=lambda f: f.stat().st_size)


def _clean_filename(name: str) -> str:
    """Sanitizes a title for use as a filename."""
    name = re.sub(r'[<>:"/\\|?*]', '', name)
    name = re.sub(r'\s+', ' ', name).strip()
    return name or "download"


# ─── Entry point ─────────────────────────────────────────────────────
if __name__ == "__main__":
    print("═══════════════════════════════════════════")
    print("🎬  ATMOS Download Manager")
    print("    http://localhost:8765")
    print("═══════════════════════════════════════════")
    print(f"  GDrive folder : {GDRIVE_FOLDER_ID or '(root)'}")
    print(f"  GDrive creds  : {'✅ set' if GDRIVE_CREDENTIALS else '❌ missing — set GDRIVE_CREDENTIALS in .env'}")
    print(f"  TMDB key      : {'✅ set' if TMDB_API_KEY else '⚠️  not set — search disabled'}")
    print(f"  Download dir  : {DOWNLOAD_DIR}")
    print("═══════════════════════════════════════════")
    uvicorn.run(app, host="0.0.0.0", port=8765, log_level="warning")
