"""Admin System Router — system, config, logs, restart, health, analytics, bot-info, telegram/send"""

import os
import sys
import time
import json
import signal
import threading
from collections import deque
from fastapi import APIRouter, Request, Depends
from fastapi.responses import JSONResponse

from utils.auth import require_admin
from utils.human_size import human_size as _human_size
from transfer_manager import TransferManager
from persistent_queue import PersistentQueue
from gdrive_uploader import get_drive_storage_info
import telegram_bot

router = APIRouter()

GDRIVE_CREDENTIALS = os.environ.get("GDRIVE_CREDENTIALS", "")

tm = TransferManager()
pq = PersistentQueue()

# ─── Analytics ───────────────────────────────────────────────────
ANALYTICS_FILE = "analytics.json"
_analytics_lock = threading.Lock()


def _load_analytics():
    if os.path.exists(ANALYTICS_FILE):
        try:
            with open(ANALYTICS_FILE, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return {"total_views": 0, "stream_starts": 0}


def _save_analytics(data):
    try:
        tmp_file = ANALYTICS_FILE + ".tmp"
        with open(tmp_file, "w") as f:
            json.dump(data, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_file, ANALYTICS_FILE)
    except Exception:
        pass


app_analytics = _load_analytics()

# ─── Log Queue (shared) ─────────────────────────────────────────
log_queue = deque(maxlen=500)

# ─── Activity Feed ───────────────────────────────────────────────
_activity_feed = deque(maxlen=200)
_server_start_time = time.time()


def log_activity(icon, text, category="info"):
    _activity_feed.appendleft({
        "icon": icon, "text": text, "category": category,
        "ts": time.strftime("%H:%M:%S"), "epoch": time.time()
    })


log_activity("🚀", "Server started", "system")

# ─── Reorganize subprocess tracking ─────────────────────────────
_reorganize_proc = None


@router.get("/system", dependencies=[Depends(require_admin)])
def api_admin_system(request: Request):
    stats = tm.get_stats()
    storage = get_drive_storage_info(GDRIVE_CREDENTIALS) if GDRIVE_CREDENTIALS else {}
    return JSONResponse({
        "bot_online": bool(telegram_bot.app),
        "drive_connected": bool(GDRIVE_CREDENTIALS),
        "total_files": stats.get('total_files', 0),
        "total_size": stats.get('total_size_human', '0 B'),
        "active_transfers": stats.get('active_transfers', 0),
        "active_transfer_details": tm.get_active_transfers(),
        "failed_transfers": tm.get_errors(),
        "queue_size": pq.get_stats().get('queued', 0),
        "uptime": stats.get('uptime', '00:00:00'),
        "storage": storage,
        "analytics": app_analytics
    })


@router.get("/config", dependencies=[Depends(require_admin)])
def api_admin_config(request: Request):
    keys = ['GDRIVE_CREDENTIALS', 'GDRIVE_FOLDER_ID', 'TELEGRAM_BOT_TOKEN',
            'TELEGRAM_API_ID', 'TELEGRAM_API_HASH', 'TELEGRAM_USER_ID']
    status = {k: "✅ Set" if os.environ.get(k) else "❌ Missing" for k in keys}
    return JSONResponse({"config": status})


@router.get("/logs", dependencies=[Depends(require_admin)])
def api_admin_logs(request: Request):
    return JSONResponse({"logs": list(log_queue)})


@router.post("/restart", dependencies=[Depends(require_admin)])
async def api_admin_restart(request: Request):
    def delay_shutdown():
        time.sleep(1)
        os.kill(os.getpid(), signal.SIGTERM)
    threading.Thread(target=delay_shutdown, daemon=True).start()
    return JSONResponse({"success": True, "message": "Restarting server gracefully..."})


@router.post("/reorganize", dependencies=[Depends(require_admin)])
async def api_admin_reorganize(request: Request):
    """Retroactively organizes files into the correct hierarchy."""
    global _reorganize_proc
    if _reorganize_proc is not None and _reorganize_proc.poll() is None:
        return JSONResponse({"error": "Reorganization already in progress"}, status_code=409)
    import subprocess
    try:
        _reorganize_proc = subprocess.Popen(
            [sys.executable, "reorganize_drive.py"], cwd=os.getcwd()
        )
    except Exception as e:
        _reorganize_proc = None
        return JSONResponse({"error": f"Failed to start: {e}"}, status_code=500)
    return JSONResponse({"success": True, "message": "Reorganization started in background."})


@router.get("/history", dependencies=[Depends(require_admin)])
def api_admin_history(request: Request):
    completed = [t.to_dict() for t in tm.completed[:50]] if hasattr(tm, 'completed') else []
    failed = [t.to_dict() for t in tm.failed[:50]] if hasattr(tm, 'failed') else []
    return JSONResponse({"history": completed + failed, "transfers": completed + failed})


@router.post("/telegram/send", dependencies=[Depends(require_admin)])
async def api_admin_telegram_send(request: Request):
    try:
        data = await request.json()
        message_text = data.get("message", "")
        if not message_text:
            return JSONResponse({"error": "Empty message"}, status_code=400)
        if not telegram_bot.app or not telegram_bot.app.is_initialized:
            return JSONResponse({"error": "Bot not running"}, status_code=503)
        user_id = int(os.environ.get("TELEGRAM_USER_ID", "0"))
        if not user_id:
            return JSONResponse({"error": "TELEGRAM_USER_ID not set"}, status_code=500)
        sent = await telegram_bot.app.send_message(user_id, message_text)
        return JSONResponse({"success": True, "message_id": sent.id})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/analytics/reset", dependencies=[Depends(require_admin)])
async def api_admin_analytics_reset(request: Request):
    global app_analytics
    with _analytics_lock:
        app_analytics = {"total_views": 0, "stream_starts": 0}
        _save_analytics(app_analytics)
    return JSONResponse({"success": True, "message": "Analytics reset."})


@router.get("/bot-info", dependencies=[Depends(require_admin)])
def api_admin_bot_info(request: Request):
    bot_running = bool(telegram_bot.app and telegram_bot.app.is_initialized)
    q_stats = pq.get_stats()
    return JSONResponse({
        "bot_running": bot_running,
        "bot_username": getattr(telegram_bot.app, 'me', {}).username
            if bot_running and hasattr(getattr(telegram_bot.app, 'me', None) or object(), 'username')
            else "unknown",
        "allowed_user_id": os.environ.get("TELEGRAM_USER_ID", "not set"),
        "queue_size": q_stats.get('queued', 0),
        "active_workers": q_stats.get('active', 0),
        "completed": q_stats.get('completed', 0),
        "failed": q_stats.get('failed', 0),
        "worker_active": bot_running,
    })


@router.get("/health", dependencies=[Depends(require_admin)])
def api_admin_health(request: Request):
    health = {
        "cpu_percent": 0, "memory_percent": 0, "memory_used": "", "memory_total": "",
        "disk_percent": 0, "disk_used": "", "disk_total": "", "uptime_seconds": 0,
        "python_version": sys.version.split()[0], "platform": sys.platform
    }
    try:
        import psutil
        health["cpu_percent"] = psutil.cpu_percent(interval=0.5)
        mem = psutil.virtual_memory()
        health["memory_percent"] = mem.percent
        health["memory_used"] = _human_size(mem.used)
        health["memory_total"] = _human_size(mem.total)
        disk = psutil.disk_usage("/")
        health["disk_percent"] = disk.percent
        health["disk_used"] = _human_size(disk.used)
        health["disk_total"] = _human_size(disk.total)
    except ImportError:
        pass
    health["uptime_seconds"] = int(time.time() - _server_start_time)
    h, rem = divmod(health["uptime_seconds"], 3600)
    m, s = divmod(rem, 60)
    health["uptime_human"] = f"{h:02d}:{m:02d}:{s:02d}"
    t0 = time.time()
    try:
        import urllib.request
        urllib.request.urlopen("http://localhost:7860/api/videos", timeout=3)
    except Exception:
        pass
    health["api_latency_ms"] = round((time.time() - t0) * 1000)
    return JSONResponse(health)


@router.get("/activity", dependencies=[Depends(require_admin)])
def api_admin_activity(request: Request):
    limit = int(request.query_params.get("limit", 50))
    return JSONResponse({"events": list(_activity_feed)[:limit]})
