import sys
import logging
import asyncio
import time
import hmac
import hashlib
import concurrent.futures
from collections import deque, OrderedDict

# Load dev phase secrets
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from typing import Optional, List, Dict, Any


log_queue = deque(maxlen=500)

class QueueLogger:
    def write(self, msg):
        if not msg.strip():
            return
        # Filter out noisy uvicorn access logs to prevent spam
        if any(x in msg for x in ["GET /api/admin/logs", "GET /api/admin/system", "GET /api/videos", "GET /api/admin/bot-info"]):
            return
            
        log_queue.append(msg.strip())
        sys.__stdout__.write(msg)
        
    def flush(self):
        sys.__stdout__.flush()
        
    def isatty(self):
        return False

sys.stdout = QueueLogger()
sys.stderr = QueueLogger()

import os
import re
import io
import threading
import json
import metadata_fetcher
from media_classifier import MediaClassifier
from fastapi import FastAPI, Request
from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse, Response, RedirectResponse
import telegram_bot
from gdrive_uploader import (
    get_drive_service, upload_file_to_drive,
    list_drive_folder, get_drive_storage_info, auto_share_file,
    rename_file, delete_file
)
from transfer_manager import TransferManager, _human_size
from persistent_queue import PersistentQueue
import smart_search
import torrent_search

pq = PersistentQueue()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ─── Boot Telegram bot inside the main event loop ───
    print("🚀 Unified Startup: Booting Telegram Bot...")
    asyncio.create_task(telegram_bot.run_bot_async())
    yield
    print("🛑 Unified Shutdown: Stopping resources...")

# ─── FastAPI app ──────────────────────────────────────────────────
fastapi_app = FastAPI(lifespan=lifespan)

# [C3] Restrict CORS to known frontend origins instead of wildcard
ALLOWED_ORIGINS = [
    "https://atmos.page.gd",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "https://frontend-one-teal-19.vercel.app"
]
fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Range", "Accept-Ranges", "Content-Length"],
)

try:
    from downloader_server import app as downloader_app
    fastapi_app.mount("/downloader", downloader_app)
    print("✅ Downloader API mounted at /downloader")
except Exception as e:
    print(f"⚠️ Failed to mount downloader API: {e}")

# ─── Rate Limiter (Token Bucket) ─────────────────────────────────
_rate_buckets = OrderedDict()  # ip -> {tokens, last_refill}
_RATE_MAX_TOKENS = 30       # burst capacity
_RATE_REFILL_RATE = 10      # tokens per second
_RATE_BUCKET_MAX = 5000     # max tracked IPs

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse as StarletteJSON

class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        ip = request.client.host if request.client else "0.0.0.0"
        # Skip rate limiting for health checks and static
        if request.url.path in ("/health", "/", "/api/admin/login"):
            return await call_next(request)
        now = time.time()
        if ip not in _rate_buckets:
            _rate_buckets[ip] = {"tokens": _RATE_MAX_TOKENS, "last": now}
        bucket = _rate_buckets[ip]
        elapsed = now - bucket["last"]
        bucket["tokens"] = min(_RATE_MAX_TOKENS, bucket["tokens"] + elapsed * _RATE_REFILL_RATE)
        bucket["last"] = now
        if bucket["tokens"] < 1:
            return StarletteJSON({"error": "Rate limit exceeded"}, status_code=429)
        bucket["tokens"] -= 1
        _rate_buckets.move_to_end(ip)
        while len(_rate_buckets) > _RATE_BUCKET_MAX:
            _rate_buckets.popitem(last=False)
        return await call_next(request)

fastapi_app.add_middleware(RateLimitMiddleware)

# ─── Secrets ─────────────────────────────────────────────────────
GDRIVE_CREDENTIALS = os.environ.get("GDRIVE_CREDENTIALS", "")
GDRIVE_FOLDER_ID = os.environ.get("GDRIVE_FOLDER_ID", "")
# [C3] Hardcoded Admin Password
ADMIN_PASSWORD = "1908"
# Dedicated media server for streaming, remux, and subtitles
MEDIA_SERVER_URL = os.environ.get("MEDIA_SERVER_URL", "https://nikhil1776-atmos-media.hf.space")
tm = TransferManager()

# [H8] Thread-safe analytics with a lock
_analytics_lock = threading.Lock()
# [CR2-C4] Thread-local for reusable stream sessions
_tl_stream = threading.local()

# ─── Analytics ───────────────────────────────────────────────────
ANALYTICS_FILE = "analytics.json"

def load_analytics():
    if os.path.exists(ANALYTICS_FILE):
        try:
            with open(ANALYTICS_FILE, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return {"total_views": 0, "stream_starts": 0}

def save_analytics(data):
    """[CR2-H2] Atomic save with fsync to prevent corruption."""
    try:
        tmp_file = ANALYTICS_FILE + ".tmp"
        with open(tmp_file, "w") as f:
            json.dump(data, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_file, ANALYTICS_FILE)
    except Exception:
        pass

app_analytics = load_analytics()

# [C3][CR2-C3] Bounded rate limiter for auth failures (max 10k entries, LRU eviction)
_AUTH_MAX_ENTRIES = 10000
_auth_failures = OrderedDict()  # ip -> (count, last_attempt_time)
_AUTH_MAX_FAILURES = 10
_AUTH_LOCKOUT_SECONDS = 300

def _create_admin_token(ttl: int = 86400) -> str:
    """Create HMAC-signed admin session token with expiry."""
    payload = json.dumps({"exp": int(time.time()) + ttl, "role": "admin"})
    sig = hmac.new(ADMIN_PASSWORD.encode(), payload.encode(), hashlib.sha256).hexdigest()
    import base64
    return base64.b64encode(f"{payload}:{sig}".encode()).decode()

def _verify_admin_token(token: str) -> bool:
    """Verify HMAC-signed admin token."""
    try:
        import base64
        decoded = base64.b64decode(token).decode()
        payload, sig = decoded.rsplit(":", 1)
        expected = hmac.new(ADMIN_PASSWORD.encode(), payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return False
        data = json.loads(payload)
        return data.get("exp", 0) > time.time()
    except Exception:
        return False

def check_admin_auth(request: Request) -> bool:
    """Validate admin auth via HMAC token or password header."""
    ip = request.client.host if request.client else "unknown"

    # Rate limit check
    if ip in _auth_failures:
        count, last_time = _auth_failures[ip]
        if count >= _AUTH_MAX_FAILURES and (time.time() - last_time) < _AUTH_LOCKOUT_SECONDS:
            return False

    # Check Bearer token first (HMAC session)
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        if _verify_admin_token(token):
            return True

    # Fallback: password header (for backwards compat)
    pwd = request.headers.get("x-admin-password", "")
    if pwd and hmac.compare_digest(pwd, ADMIN_PASSWORD):
        return True

    # Track failure
    if ip in _auth_failures:
        count, _ = _auth_failures[ip]
        _auth_failures[ip] = (count + 1, time.time())
    else:
        _auth_failures[ip] = (1, time.time())
    while len(_auth_failures) > _AUTH_MAX_ENTRIES:
        _auth_failures.popitem(last=False)
    return False

@fastapi_app.post("/api/admin/login")
async def admin_login(request: Request):
    """Login with password, returns HMAC session token."""
    try:
        body = await request.json()
        pwd = body.get("password", "")
    except Exception:
        pwd = request.headers.get("x-admin-password", "")
    if hmac.compare_digest(pwd, ADMIN_PASSWORD):
        token = _create_admin_token()
        return JSONResponse({"token": token, "expires_in": 86400})
    return JSONResponse({"error": "Invalid password"}, status_code=401)

# ═══════════════════════════════════════════════════════════════════
#  REST API — Video List
# ═══════════════════════════════════════════════════════════════════

# ─── Cache & State ──────────────────────────────────────────────
_video_cache = {"data": None, "timestamp": 0}
_video_cache_lock = threading.Lock()  # [CR2-H1] Guard concurrent cache access
CACHE_TTL = 300  # 5 minutes
_background_refresh_active = False

def _process_single_video(f):
    """Worker function to process a single video file."""
    name = f.get('name', '')
    mime = f.get('mimeType', '')
    
    # 1. Advanced Parsing via MediaClassifier
    parsed = MediaClassifier.parse(name)
    title = parsed.get("title")
    year = parsed.get("year")
    m_type = "tv" if parsed["type"] in ["show", "anime"] else "movie"
    
    # 2. Extract Folder-Based Hints (Mirroring Drive Structure)
    folder_path = f.get('folder_path', '')
    folder_parts = [p.strip() for p in folder_path.split('/') if p.strip()]
    
    drive_show_title = ""
    drive_season = None
    
    # If organized in "TV Shows/ShowName/Season X"
    if len(folder_parts) >= 2 and folder_parts[0].lower() == "tv shows":
        drive_show_title = folder_parts[1]
        if len(folder_parts) >= 3 and "season" in folder_parts[2].lower():
            try:
                drive_season = int(re.search(r'\d+', folder_parts[2]).group())
            except: pass
    
    # If folder suggests it's a show, override m_type
    if drive_show_title:
        m_type = "tv"
    
    # 3. Fetch Metadata with refined search
    search_title = drive_show_title or title
    meta = metadata_fetcher.get_metadata(search_title, year=year, media_type=m_type)

    # 4. Build High-End Video Object
    video_obj = {
        "id": f['id'],
        "name": name,
        "size": f.get('size_human', '—'),
        "size_bytes": f.get('size_bytes', 0),
        "modified": f.get('modifiedTime', '')[:10],
        "mime": mime,
        "stream_url": f"/api/stream/{f.get('id')}",
        "folder_path": folder_path,
        # Visuals - Prioritize high-quality TMDB assets
        "thumbnail_url": f.get('thumbnail_url', ''),
        "poster_url": meta.get("poster_url") or f.get('thumbnail_url', ''),
        "backdrop_url": meta.get("backdrop_url") or meta.get("poster_url") or f.get('thumbnail_url', ''),
        # Metadata
        "title": meta.get("tmdb_title") or title,
        "year": meta.get("release_date")[:4] if meta.get("release_date") else (str(year) if year else ""),
        "rating": meta.get("rating", 0),
        "synopsis": meta.get("synopsis", ""),
        "quality": _parse_quality(name),
        "type": "series" if m_type == "tv" else "movie"
    }

    if m_type == "tv":
        video_obj.update({
            "show_title": drive_show_title or title,
            "season": drive_season or parsed.get("season", 1),
            "episode": parsed.get("episode", 1),
        })
    else:
        video_obj["type"] = "movie"

    return video_obj

def _fetch_videos_from_drive():
    global _video_cache, _background_refresh_active
    try:
        # List files (recursive to find nested movies/shows)
        files = list_drive_folder(GDRIVE_CREDENTIALS, GDRIVE_FOLDER_ID, page_size=500, recursive=True)

        video_extensions = {'.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv', '.m4v', '.ts'}
        
        # Filter files first
        valid_files = []
        for f in files:
            name = f.get('name', '')
            ext = os.path.splitext(name)[1].lower()
            mime = f.get('mimeType', '')
            if ext in video_extensions or 'video' in mime:
                valid_files.append(f)
        
        # Process files concurrently
        videos = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            for video_obj in executor.map(_process_single_video, valid_files):
                videos.append(video_obj)

        response_data = {
            "videos": videos,
            "total": len(videos),
            "cached": False,
            "media_base_url": MEDIA_SERVER_URL,
        }
        
        with _video_cache_lock:
            _video_cache = {"data": response_data, "timestamp": time.time()}
            
    except Exception as e:
        print(f"Error in background fetch: {e}")
    finally:
        with _video_cache_lock:
            _background_refresh_active = False

@fastapi_app.get("/api/files")
@fastapi_app.get("/api/videos")
def api_get_videos(force_refresh: bool = False):
    global _video_cache, _background_refresh_active
    if not GDRIVE_CREDENTIALS:
        return JSONResponse({"error": "Drive not configured", "videos": []}, status_code=500)

    now = time.time()
    trigger_bg_refresh = False
    
    with _video_cache_lock:
        cache_valid = _video_cache["data"] and (now - _video_cache["timestamp"] < CACHE_TTL)
        
        if force_refresh or not cache_valid:
            # If we don't have ANY data, we MUST wait synchronously
            if not _video_cache["data"]:
                trigger_bg_refresh = False
                # Run synchronously for the first ever load
            elif not _background_refresh_active:
                trigger_bg_refresh = True
                _background_refresh_active = True

    if trigger_bg_refresh:
        # We have stale data, return it instantly and fetch new data in background
        threading.Thread(target=_fetch_videos_from_drive, daemon=True).start()
        with _video_cache_lock:
            resp_data = dict(_video_cache["data"])
            resp_data["cached"] = True
            return JSONResponse(resp_data)
            
    # If no data exists, block and wait
    if force_refresh or not _video_cache["data"] or not cache_valid:
        with _video_cache_lock:
            _background_refresh_active = True
        _fetch_videos_from_drive()
        
    with _video_cache_lock:
        return JSONResponse(_video_cache["data"])


# [H11] Removed unauthenticated GET /api/admin/share-all — use the POST version below


# ═══════════════════════════════════════════════════════════════════
#  REST API — Admin Operations
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.post("/api/admin/rename/{file_id}")
async def api_admin_rename(file_id: str, request: Request):
    if not GDRIVE_CREDENTIALS:
        return JSONResponse({"error": "Not configured"}, status_code=500)
    # [C3] Use rate-limited auth check
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    # [H9] Validate file_id format
    if not re.match(r'^[a-zA-Z0-9_-]+$', file_id):
        return JSONResponse({"error": "Invalid file ID"}, status_code=400)
    try:
        data = await request.json()
        new_name = data.get("new_name")
        rename_file(GDRIVE_CREDENTIALS, file_id, new_name)
        return JSONResponse({"success": True, "new_name": new_name})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

@fastapi_app.post("/api/admin/delete/{file_id}")
async def api_admin_delete(file_id: str, request: Request):
    if not GDRIVE_CREDENTIALS:
        return JSONResponse({"error": "Not configured"}, status_code=500)
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    if not re.match(r'^[a-zA-Z0-9_-]+$', file_id):
        return JSONResponse({"error": "Invalid file ID"}, status_code=400)
    try:
        delete_file(GDRIVE_CREDENTIALS, file_id)
        return JSONResponse({"success": True})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

@fastapi_app.post("/api/admin/auto-rename")
async def api_admin_auto_rename(request: Request):
    """Batch rename all Drive files using MediaClassifier + TMDB lookup."""
    if not GDRIVE_CREDENTIALS:
        return JSONResponse({"error": "Not configured"}, status_code=500)
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    
    try:
        from gdrive_uploader import get_drive_service, rename_file
        service = get_drive_service(GDRIVE_CREDENTIALS)
        
        # Helper to recursively get all files (bypassing list_drive_folder's limit)
        def _get_all_files(fid, current_path=""):
            q = f"'{fid}' in parents and trashed = false"
            page_token = None
            found_files = []
            while True:
                res = service.files().list(
                    q=q,
                    pageSize=1000,
                    pageToken=page_token,
                    fields="nextPageToken, files(id, name, mimeType, originalFilename)"
                ).execute()
                
                for f in res.get('files', []):
                    if f['mimeType'] == 'application/vnd.google-apps.folder':
                        new_path = f"{current_path}/{f['name']}" if current_path else f['name']
                        found_files.extend(_get_all_files(f['id'], new_path))
                    else:
                        f['folder_path'] = current_path
                        found_files.append(f)
                
                page_token = res.get('nextPageToken')
                if not page_token:
                    break
            return found_files
            
        files = _get_all_files(GDRIVE_FOLDER_ID)
        video_extensions = {'.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv', '.m4v', '.ts'}
        
        renamed = []
        skipped = []
        errors = []
        
        for f in files:
            old_name = f.get('name', '')
            ext = os.path.splitext(old_name)[1].lower()
            mime = f.get('mimeType', '')
            
            if ext not in video_extensions and 'video' not in mime:
                continue
            
            try:
                folder_path = f.get('folder_path', '')
                folder_parts = [p.strip() for p in folder_path.split('/') if p.strip()]
                drive_show_title = ""
                drive_season = None
                
                if len(folder_parts) >= 2 and folder_parts[0].lower() == "tv shows":
                    drive_show_title = folder_parts[1]
                    if len(folder_parts) >= 3 and "season" in folder_parts[2].lower():
                        try:
                            drive_season = int(re.search(r'\d+', folder_parts[2]).group())
                        except: pass

                # Parse with MediaClassifier
                parsed = MediaClassifier.parse(old_name)
                
                # If folder implies TV show, enforce it
                if drive_show_title:
                    parsed['type'] = 'show'
                    parsed['title'] = drive_show_title
                    if drive_season and not parsed.get('season'):
                        parsed['season'] = drive_season
                
                raw_title = parsed.get("title") or ""
                
                if not raw_title or raw_title == "Unknown":
                    print(f"⚠️ Auto-Rename: Skipping '{old_name}' (Could not parse title)")
                    skipped.append({"id": f['id'], "name": old_name, "reason": "Could not parse title"})
                    continue
                
                # TMDB lookup for authoritative title
                m_type = "tv" if parsed["type"] in ["show", "anime"] else "movie"
                try:
                    meta = metadata_fetcher.get_metadata(raw_title, year=str(parsed.get('year', '')), media_type=m_type)
                    clean_title = meta.get("tmdb_title") or raw_title
                except Exception:
                    clean_title = raw_title
                
                # Build clean filename
                clean_name = clean_title
                
                # SAFEGUARD: If it's a TV show, MUST have an episode number, else skip to prevent wiping out episode identity
                if parsed.get("type") in ["show", "anime"] and not parsed.get("episode"):
                    print(f"⚠️ Auto-Rename: Skipping '{old_name}' (TV show missing episode number)")
                    skipped.append({"id": f['id'], "name": old_name, "reason": "Missing episode number"})
                    continue
                
                if parsed.get("year"):
                    clean_name += f" ({parsed['year']})"
                if parsed.get("season"):
                    clean_name += f" S{parsed['season']:02d}E{parsed['episode']:02d}"
                elif parsed.get("episode"):
                    clean_name += f" Ep.{parsed['episode']}"
                if parsed.get("quality"):
                    clean_name += f" [{parsed['quality']}]"
                clean_name += ext or ".mkv"
                
                # Skip if name is already clean (or very similar)
                if clean_name.lower().strip() == old_name.lower().strip():
                    print(f"⏭️ Auto-Rename: Already clean '{old_name}'")
                    skipped.append({"id": f['id'], "name": old_name, "reason": "Already clean"})
                    continue
                
                # Rename on Drive
                print(f"✏️ Auto-Rename: '{old_name}' ➔ '{clean_name}'")
                rename_file(GDRIVE_CREDENTIALS, f['id'], clean_name)
                renamed.append({"id": f['id'], "old": old_name, "new": clean_name})
                
            except Exception as e:
                print(f"❌ Auto-Rename Error on '{old_name}': {e}")
                errors.append({"id": f['id'], "name": old_name, "error": str(e)[:200]})
        
        print(f"✅ Auto-Rename Batch Complete! Renamed: {len(renamed)}, Skipped: {len(skipped)}, Errors: {len(errors)}")
        
        # Invalidate video cache after renaming
        global _video_cache
        with _video_cache_lock:
            _video_cache = {"data": None, "timestamp": 0}
        
        return JSONResponse({
            "success": True,
            "renamed": len(renamed),
            "skipped": len(skipped),
            "errors": len(errors),
            "details": {
                "renamed": renamed[:50],  # Cap response size
                "skipped": skipped[:20],
                "errors": errors[:20],
            }
        })
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

@fastapi_app.post("/api/admin/undo-rename")
async def api_admin_undo_rename(request: Request):
    """Revert ALL files in the target folder to their original names uploaded to Google Drive."""
    if not GDRIVE_CREDENTIALS:
        return JSONResponse({"error": "Not configured"}, status_code=500)
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    
    try:
        from gdrive_uploader import get_drive_service, rename_file
        service = get_drive_service(GDRIVE_CREDENTIALS)
        
        # Helper to recursively get all files (bypassing list_drive_folder's 100 file limit)
        def _get_all_files(fid):
            q = f"'{fid}' in parents and trashed = false"
            page_token = None
            found_files = []
            while True:
                res = service.files().list(
                    q=q,
                    pageSize=1000,
                    pageToken=page_token,
                    fields="nextPageToken, files(id, name, mimeType, originalFilename)"
                ).execute()
                
                for f in res.get('files', []):
                    if f['mimeType'] == 'application/vnd.google-apps.folder':
                        found_files.extend(_get_all_files(f['id']))
                    else:
                        found_files.append(f)
                
                page_token = res.get('nextPageToken')
                if not page_token:
                    break
            return found_files
            
        all_files = _get_all_files(GDRIVE_FOLDER_ID)
        
        restored = 0
        skipped = 0
        
        for f in all_files:
            current_name = f.get('name')
            original_name = f.get('originalFilename')
            
            if original_name and current_name != original_name:
                print(f"🔄 Undo-Rename: '{current_name}' ➔ '{original_name}'")
                rename_file(GDRIVE_CREDENTIALS, f['id'], original_name)
                restored += 1
            else:
                skipped += 1
                
        # Invalidate cache
        global _video_cache
        with _video_cache_lock:
            _video_cache = {"data": None, "timestamp": 0}
            
        return JSONResponse({"success": True, "restored": restored, "skipped": skipped})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse({"error": str(e)}, status_code=500)

# ═══════════════════════════════════════════════════════════════════
#  REST API — Video Streaming Proxy (with Range Request support)
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/stream/{file_id}")
@fastapi_app.head("/api/stream/{file_id}")
async def stream_video(file_id: str, request: Request):
    """
    Proxies video from Google Drive with full Range request support.
    This enables smooth seeking in the HTML5 video player.
    """
    # [H9] Validate file_id format
    if not re.match(r'^[a-zA-Z0-9_-]+$', file_id):
        return JSONResponse({"error": "Invalid file ID"}, status_code=400)

    # Only increment stream stat on initial load, not subsequent range requests
    if not request.headers.get('range') or request.headers.get('range') == 'bytes=0-':
        # [H8] Thread-safe analytics update
        with _analytics_lock:
            app_analytics["stream_starts"] += 1
            save_analytics(app_analytics)

    if not GDRIVE_CREDENTIALS:
        return JSONResponse({"error": "Not configured"}, status_code=500)

    try:
        service = get_drive_service(GDRIVE_CREDENTIALS)

        # Get file metadata
        file_meta = service.files().get(
            fileId=file_id, fields="name,size,mimeType"
        ).execute()
        file_size = int(file_meta.get('size', 0))
        mime_type = file_meta.get('mimeType', 'video/mp4')
        
        # Spoof MKV files as WebM to force browsers to use their native WebM demuxer.
        # This allows full playback on Desktop Chrome, and audio playback on mobile.
        # (Spoofing as MP4 completely breaks the container parsing on most devices).
        if 'matroska' in mime_type.lower() or mime_type == 'application/octet-stream':
            mime_type = 'video/webm'

        if request.method == "HEAD":
            return Response(
                status_code=200,
                headers={
                    'Content-Length': str(file_size),
                    'Accept-Ranges': 'bytes',
                    'Content-Type': mime_type,
                    'Cache-Control': 'public, max-age=3600',
                }
            )

        # Build authenticated download URL
        download_url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media"

        # [CR2-C4] Reuse session from thread-local to avoid socket leak
        from google.auth.transport.requests import AuthorizedSession
        creds = service._http.credentials
        if not hasattr(_tl_stream, 'session') or _tl_stream.creds_id != id(creds):
            _tl_stream.session = AuthorizedSession(creds)
            _tl_stream.creds_id = id(creds)
        session = _tl_stream.session

        range_header = request.headers.get('range', '')

        if range_header:
            # ── Partial Content (206) ──
            match = re.match(r'bytes=(\d+)-(\d*)', range_header)
            if not match:
                return Response(status_code=400)

            start = int(match.group(1))
            # 2MB chunks for smoother playback on slower connections
            end = int(match.group(2)) if match.group(2) else min(start + 2 * 1024 * 1024 - 1, file_size - 1)
            end = min(end, file_size - 1)
            chunk_size = end - start + 1

            resp = await asyncio.to_thread(
                session.get,
                download_url,
                headers={'Range': f'bytes={start}-{end}'},
                stream=True
            )

            if resp.status_code == 403:
                return JSONResponse({"error": "Google Drive Download Quota Exceeded. Please try again later."}, status_code=429)
            elif resp.status_code >= 400:
                return JSONResponse({"error": f"Upstream error: {resp.status_code}"}, status_code=502)

            async def iterchunks():
                try:
                    iterator = resp.iter_content(chunk_size=1024 * 1024)
                    while True:
                        chunk = await asyncio.to_thread(next, iterator, None)
                        if chunk is None:
                            break
                        yield chunk
                finally:
                    resp.close()

            return StreamingResponse(
                iterchunks(),
                status_code=206,
                media_type=mime_type,
                headers={
                    'Content-Range': f'bytes {start}-{end}/{file_size}',
                    'Content-Length': str(chunk_size),
                    'Accept-Ranges': 'bytes',
                    'Cache-Control': 'public, max-age=3600',
                }
            )
        else:
            # ── Full file (200) — return first chunk + headers ──
            # Browsers typically follow up with range requests
            resp = await asyncio.to_thread(
                session.get,
                download_url,
                stream=True
            )

            if resp.status_code == 403:
                return JSONResponse({"error": "Google Drive Download Quota Exceeded. Please try again later."}, status_code=429)
            elif resp.status_code >= 400:
                return JSONResponse({"error": f"Upstream error: {resp.status_code}"}, status_code=502)

            async def iterchunks():
                try:
                    iterator = resp.iter_content(chunk_size=1024 * 1024)
                    while True:
                        chunk = await asyncio.to_thread(next, iterator, None)
                        if chunk is None:
                            break
                        yield chunk
                finally:
                    resp.close()

            return StreamingResponse(
                iterchunks(),
                status_code=200,
                media_type=mime_type,
                headers={
                    'Content-Length': str(file_size),
                    'Accept-Ranges': 'bytes',
                    'Cache-Control': 'public, max-age=3600',
                }
            )
    except Exception as e:
        print(f"Stream error: {e}")
        return JSONResponse({"error": str(e)[:300]}, status_code=500)


# ═══════════════════════════════════════════════════════════════════
#  Track Detection & Subtitle Extraction (FFprobe/FFmpeg)
# ═══════════════════════════════════════════════════════════════════

def _get_ffprobe_path():
    """Find ffprobe binary — system install or imageio-ffmpeg fallback."""
    import shutil
    path = shutil.which("ffprobe")
    if path:
        return path
    try:
        import imageio_ffmpeg
        # imageio-ffmpeg bundles ffmpeg; ffprobe is at the same location with different name
        ff = imageio_ffmpeg.get_ffmpeg_exe()
        probe = ff.replace("ffmpeg", "ffprobe")
        if os.path.exists(probe):
            return probe
    except ImportError:
        pass
    return None

def _get_ffmpeg_path():
    """Find ffmpeg binary."""
    import shutil
    path = shutil.which("ffmpeg")
    if path:
        return path
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        pass
    return None

# In-memory subtitle cache: { "file_id:track_index": vtt_bytes }
_subtitle_cache = {}

@fastapi_app.get("/api/tracks/{file_id}")
async def get_tracks(file_id: str, request: Request):
    """Probe a Drive file for audio and subtitle track metadata using ffprobe."""
    if not re.match(r'^[a-zA-Z0-9_-]+$', file_id):
        return JSONResponse({"error": "Invalid file ID"}, status_code=400)

    ffprobe = _get_ffprobe_path()
    if not ffprobe:
        return JSONResponse({"error": "ffprobe not available"}, status_code=501)

    if not GDRIVE_CREDENTIALS:
        return JSONResponse({"error": "Not configured"}, status_code=500)

    try:
        service = get_drive_service(GDRIVE_CREDENTIALS)
        # Build authenticated URL
        from google.auth.transport.requests import AuthorizedSession, Request as AuthRequest
        creds = service._http.credentials
        creds.refresh(AuthRequest())
        access_token = creds.token
        download_url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media"

        # Run ffprobe with auth header — only read first 10MB for speed
        import subprocess
        cmd = [
            ffprobe, "-v", "quiet",
            "-print_format", "json",
            "-show_streams",
            "-headers", f"Authorization: Bearer {access_token}\r\n",
            download_url
        ]
        result = await asyncio.to_thread(
            subprocess.run, cmd,
            capture_output=True, text=True, timeout=30
        )

        if result.returncode != 0:
            return JSONResponse({"error": "ffprobe failed", "stderr": result.stderr[:300]}, status_code=500)

        import json as _json
        probe_data = _json.loads(result.stdout)
        streams = probe_data.get("streams", [])

        audio_tracks = []
        subtitle_tracks = []
        audio_idx = 0
        sub_idx = 0

        for s in streams:
            codec_type = s.get("codec_type", "")
            tags = s.get("tags", {})
            lang = tags.get("language", tags.get("LANGUAGE", ""))
            title = tags.get("title", tags.get("TITLE", ""))
            label = title or lang or ""

            if codec_type == "audio":
                audio_tracks.append({
                    "index": s.get("index"),
                    "stream_index": audio_idx,
                    "language": lang,
                    "label": label or f"Audio {audio_idx + 1}",
                    "codec": s.get("codec_name", ""),
                    "channels": s.get("channels", 2),
                    "default": s.get("disposition", {}).get("default", 0) == 1,
                })
                audio_idx += 1
            elif codec_type == "subtitle":
                subtitle_tracks.append({
                    "index": s.get("index"),
                    "stream_index": sub_idx,
                    "language": lang,
                    "lang_code": lang[:2] if lang else "un",
                    "label": label or lang or f"Subtitle {sub_idx + 1}",
                    "codec": s.get("codec_name", ""),
                    "forced": s.get("disposition", {}).get("forced", 0) == 1,
                    "default": s.get("disposition", {}).get("default", 0) == 1,
                })
                sub_idx += 1

        return JSONResponse({
            "audio_tracks": audio_tracks,
            "subtitle_tracks": subtitle_tracks,
        })

    except asyncio.TimeoutError:
        return JSONResponse({"error": "ffprobe timed out"}, status_code=504)
    except Exception as e:
        print(f"Track probe error: {e}")
        return JSONResponse({"error": str(e)[:300]}, status_code=500)


@fastapi_app.get("/api/subtitle/{file_id}/{track_index}")
async def get_subtitle(file_id: str, track_index: int, request: Request):
    """Extract a subtitle track from a Drive file and return as WebVTT."""
    if not re.match(r'^[a-zA-Z0-9_-]+$', file_id):
        return JSONResponse({"error": "Invalid file ID"}, status_code=400)
    if track_index < 0 or track_index > 50:
        return JSONResponse({"error": "Invalid track index"}, status_code=400)

    # Check cache
    cache_key = f"{file_id}:{track_index}"
    if cache_key in _subtitle_cache:
        return Response(
            content=_subtitle_cache[cache_key],
            media_type="text/vtt",
            headers={"Cache-Control": "public, max-age=86400"}
        )

    ffmpeg = _get_ffmpeg_path()
    if not ffmpeg:
        return JSONResponse({"error": "ffmpeg not available"}, status_code=501)

    if not GDRIVE_CREDENTIALS:
        return JSONResponse({"error": "Not configured"}, status_code=500)

    try:
        service = get_drive_service(GDRIVE_CREDENTIALS)
        from google.auth.transport.requests import Request as AuthRequest
        creds = service._http.credentials
        creds.refresh(AuthRequest())
        access_token = creds.token
        download_url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media"

        import subprocess
        cmd = [
            ffmpeg, "-v", "quiet",
            "-headers", f"Authorization: Bearer {access_token}\r\n",
            "-i", download_url,
            "-map", f"0:s:{track_index}",
            "-f", "webvtt",
            "pipe:1"
        ]
        result = await asyncio.to_thread(
            subprocess.run, cmd,
            capture_output=True, timeout=60
        )

        if result.returncode != 0:
            stderr = result.stderr.decode("utf-8", errors="replace")[:300]
            return JSONResponse({"error": "Subtitle extraction failed", "stderr": stderr}, status_code=500)

        vtt_data = result.stdout
        if not vtt_data or len(vtt_data) < 10:
            return JSONResponse({"error": "Empty subtitle track"}, status_code=404)

        # Cache it
        _subtitle_cache[cache_key] = vtt_data

        return Response(
            content=vtt_data,
            media_type="text/vtt",
            headers={"Cache-Control": "public, max-age=86400"}
        )

    except asyncio.TimeoutError:
        return JSONResponse({"error": "Subtitle extraction timed out"}, status_code=504)
    except Exception as e:
        print(f"Subtitle extraction error: {e}")
        return JSONResponse({"error": str(e)[:300]}, status_code=500)

def _parse_title(filename):
    # Strip extension
    name = os.path.splitext(filename)[0]
    
    # Remove bracketed/parenthesized tags (e.g., [Subbed], (1080p))
    name = re.sub(r'[\[\(].*?[\]\)]', ' ', name)
    
    # Remove common junk keywords
    junk = [
        '1080p', '720p', '480p', '2160p', '4k', 'bluray', 'web-dl', 'webrip', 'h264', 'h265', 'x264', 'x265', 
        'hevc', 'dual audio', 'hindi', 'english', 'multi', 'sub', 'dub', 'esub', 'org', 'aac', 'dd5.1', 'ddp5.1',
        'ac3', 'remastered', 'extended', 'uncut', 'web', 'dl', 'rip', 'brrip', 'dvdrip', 'cam', 'ts', 'hc'
    ]
    
    # Replace dots, underscores, and dashes with spaces
    for sep in ['.', '_', '-']:
        name = name.replace(sep, ' ')
        
    # Remove junk words
    pattern = re.compile(r'\b(' + '|'.join(junk) + r')\b', re.IGNORECASE)
    name = pattern.sub(' ', name)
    
    # Extract year but keep it for metadata query
    match = re.search(r'((?:19|20)\d{2})', name)
    if match:
        title = name[:match.start()].strip()
        return title if title else name.strip()
        
    return re.sub(r'\s+', ' ', name).strip()

def _parse_year(filename):
    match = re.search(r'((?:19|20)\d{2})', filename)
    return match.group(1) if match else ""

def _parse_quality(filename):
    fn = filename.lower()
    if '2160p' in fn or '4k' in fn: return '4K'
    if '1080p' in fn: return '1080p'
    if '720p' in fn: return '720p'
    if '480p' in fn: return '480p'
    return ''

def _is_series(filename):
    return bool(re.search(r'S\d+E\d+', filename, re.IGNORECASE))

def _extract_series_info(filename):
    match = re.search(r'(.*?)\s*S(\d+)E(\d+)', filename, re.IGNORECASE)
    if match:
        show_title = match.group(1)
        # Clean the title of dots and underscores
        for sep in ['.', '_']:
            show_title = show_title.replace(sep, ' ')
        show_title = show_title.strip()
        series_meta = {
            "season": int(match.group(2)),
            "episode": int(match.group(3))
        }
        return show_title, series_meta
    return filename, {"season": 1, "episode": 1}

# ═══════════════════════════════════════════════════════════════════
#  WebSocket — Real-time Admin Updates
# ═══════════════════════════════════════════════════════════════════

from fastapi import WebSocket, WebSocketDisconnect

# Connected admin clients
_ws_clients: list = []

@fastapi_app.websocket("/ws/admin")
async def ws_admin(websocket: WebSocket):
    """Real-time WebSocket feed for admin dashboard."""
    await websocket.accept()
    _ws_clients.append(websocket)
    try:
        # Send initial state
        try:
            await websocket.send_json({
                "type": "connected",
                "queue_size": pq.get_stats().get('queued', 0),
                "transfers": len(tm.get_active_transfers()) if hasattr(tm, 'get_active_transfers') else 0,
            })
        except Exception as e:
            print(f"WS initial state error: {e}")
        # Keep alive — listen for pings and commands
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        if websocket in _ws_clients:
            _ws_clients.remove(websocket)

async def ws_broadcast(event: dict):
    """Broadcast an event to all connected admin WebSocket clients."""
    dead = []
    for ws in _ws_clients:
        try:
            await ws.send_json(event)
        except Exception:
            dead.append(ws)
    for ws in dead:
        if ws in _ws_clients:
            _ws_clients.remove(ws)

# ═══════════════════════════════════════════════════════════════════
#  REST API — Admin System Metrics
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/admin/system")
def api_admin_system(request: Request):
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
        
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

@fastapi_app.get("/api/admin/config")
def api_admin_config(request: Request):
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
        
    keys = ['GDRIVE_CREDENTIALS','GDRIVE_FOLDER_ID','TELEGRAM_BOT_TOKEN', 'TELEGRAM_API_ID','TELEGRAM_API_HASH','TELEGRAM_USER_ID']
    status = {k: "✅ Set" if os.environ.get(k) else "❌ Missing" for k in keys}
    return JSONResponse({"config": status})

@fastapi_app.post("/api/admin/clear_queue")
async def api_admin_clear_queue(request: Request):
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    
    removed = pq.clear_finished()
    return JSONResponse({"success": True, "message": f"Cleared {removed} finished jobs."})

# [CR2-H6] Track reorganize subprocess properly instead of timer-based lock release
_reorganize_proc = None

@fastapi_app.post("/api/admin/reorganize")
async def api_admin_reorganize(request: Request):
    """Retroactively organizes files in the root folder into the correct hierarchy."""
    global _reorganize_proc
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    
    # [CR2-H6] Check if a previous reorganize is still running
    if _reorganize_proc is not None and _reorganize_proc.poll() is None:
        return JSONResponse({"error": "Reorganization already in progress"}, status_code=409)
    
    import subprocess
    try:
        _reorganize_proc = subprocess.Popen(
            [sys.executable, "reorganize_drive.py"],
            cwd=os.getcwd()
        )
    except Exception as e:
        _reorganize_proc = None
        return JSONResponse({"error": f"Failed to start: {e}"}, status_code=500)
    
    return JSONResponse({"success": True, "message": "Reorganization started in background. Check logs for progress."})

@fastapi_app.post("/api/admin/retry")
async def api_admin_retry(request: Request):
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    
    try:
        data = await request.json()
        chat_id = data.get("chat_id")
        message_id = data.get("message_id")
        if not chat_id or not message_id:
            return JSONResponse({"error": "Missing chat_id or message_id"}, status_code=400)
        
        await telegram_bot.retry_transfer(chat_id, message_id)
        return JSONResponse({"success": True, "message": "Transfer re-queued successfully."})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

@fastapi_app.post("/api/admin/restart")
async def api_admin_restart(request: Request):
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    
    # [H12] Graceful shutdown instead of os._exit
    import signal
    def delay_shutdown():
        time.sleep(1)
        os.kill(os.getpid(), signal.SIGTERM)
    
    threading.Thread(target=delay_shutdown, daemon=True).start()
    return JSONResponse({"success": True, "message": "Restarting server gracefully..."})

@fastapi_app.get("/api/admin/history")
def api_admin_history(request: Request):
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    history = tm.get_history(50)
    return JSONResponse({"history": history, "total": len(history)})

@fastapi_app.get("/api/admin/logs")
def api_admin_logs(request: Request):
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    return JSONResponse({"logs": list(log_queue)})

@fastapi_app.post("/api/admin/telegram/send")
async def api_admin_telegram_send(request: Request):
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
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
        
        # [CR2-M2] Removed dead code (unused bot_loop, no-op thread enumeration)
        sent = await telegram_bot.app.send_message(user_id, message_text)
        return JSONResponse({"success": True, "message_id": sent.id})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

@fastapi_app.post("/api/admin/analytics/reset")
async def api_admin_analytics_reset(request: Request):
    global app_analytics
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    with _analytics_lock:
        app_analytics = {"total_views": 0, "stream_starts": 0}
        save_analytics(app_analytics)
    return JSONResponse({"success": True, "message": "Analytics reset."})

@fastapi_app.post("/api/admin/share-all")
async def api_admin_share_all(request: Request):
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    if not GDRIVE_CREDENTIALS:
        return JSONResponse({"error": "Not configured"}, status_code=500)
    service = get_drive_service(GDRIVE_CREDENTIALS)
    files = list_drive_folder(GDRIVE_CREDENTIALS, GDRIVE_FOLDER_ID)
    shared = 0
    for f in files:
        try:
            auto_share_file(service, f['id'])
            shared += 1
        except Exception:
            pass
    return JSONResponse({"success": True, "shared": shared, "total": len(files)})

@fastapi_app.get("/api/admin/bot-info")
def api_admin_bot_info(request: Request):
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    
    bot_running = bool(telegram_bot.app and telegram_bot.app.is_initialized)
    q_stats = pq.get_stats()
    
    return JSONResponse({
        "bot_running": bot_running,
        "bot_username": getattr(telegram_bot.app, 'me', {}).username if bot_running and hasattr(getattr(telegram_bot.app, 'me', None) or object(), 'username') else "unknown",
        "allowed_user_id": os.environ.get("TELEGRAM_USER_ID", "not set"),
        "queue_size": q_stats.get('queued', 0),
        "active_workers": q_stats.get('active', 0),
        "completed": q_stats.get('completed', 0),
        "failed": q_stats.get('failed', 0),
        "worker_active": bot_running,
    })

# ═══════════════════════════════════════════════════════════════
#  DISCOVER — TMDB Search + Telegram Channel Pull
# ═══════════════════════════════════════════════════════════════

TMDB_API_KEY = os.environ.get("TMDB_API_KEY", "")
_DEFAULT_CHANNELS = ",".join([
    # ── Movies (Hollywood) ─────────────────────────────────────────
    "SeriesBayX0",          # general movies/series
    "Netflix_Seriesbots",   # Netflix content
    "MoviesFlixPro",        # HD movies
    "MoviesNestHD",         # HD movies
    "CinemaNestOfficial",   # cinema releases
    "HDHub4uOfficial",      # multi-quality movies
    "MoviesMoodOfficial",   # movie updates
    "Bollyflix_official",   # mixed content
    "GetMoviesHD",          # HD releases
    "TorrentMoviesChannel", # torrent-linked releases
    # ── TV Series ──────────────────────────────────────────────────
    "TheMoviesClub",        # TV + movies
    "webseries_freezone",   # web series
    "EnglishTVSeries4u",    # English TV
    "SeriesHouseOfficial",  # TV series archive
    "TVSeriesWorld",        # multi-platform TV
    "HindiDubedSeries",     # dubbed TV
    # ── Anime ──────────────────────────────────────────────────────
    "AnimeKaizoku",         # anime archive
    "Anime_Library",        # anime releases
    "SubsPlease",           # simulcast subs
    # ── Bollywood / South Indian ───────────────────────────────────
    "BollywoodBackup",      # Bollywood movies
    "South_Movie_Hub",      # South Indian movies
    "TamilRockerz_Official",# Tamil releases
    "TeluguFilmNagar",      # Telugu movies
    "MalayalamMoviesHub",   # Malayalam movies
    # ── 4K / Remux ─────────────────────────────────────────────────
    "UHD4KMovies",          # 4K releases
    "BluRayMoviesHD",       # BluRay remux
    "RemuxMoviesHQ",        # high-quality remux
    # ── General / Bot channels ─────────────────────────────────────
    "filestore_bot",        # general file store
    "MoviesHDBot",          # bot-based movie store
])
SOURCE_CHANNELS = [c.strip() for c in os.environ.get("TELEGRAM_SOURCE_CHANNELS", _DEFAULT_CHANNELS).split(",") if c.strip()]

# V2: Load additional channels from persistent config
_CHANNELS_FILE = "source_channels.json"
def _load_channel_config():
    global SOURCE_CHANNELS
    if os.path.exists(_CHANNELS_FILE):
        try:
            with open(_CHANNELS_FILE, "r") as f:
                extra = json.load(f)
            for ch in extra:
                if ch not in SOURCE_CHANNELS:
                    SOURCE_CHANNELS.append(ch)
        except Exception:
            pass
_load_channel_config()

def _save_channel_config():
    """Persist current channel list to disk."""
    try:
        with open(_CHANNELS_FILE, "w") as f:
            json.dump(SOURCE_CHANNELS, f)
    except Exception as e:
        print(f"Failed to save channel config: {e}")

@fastapi_app.post("/api/admin/tmdb-search")
async def api_tmdb_search(request: Request):
    """Search TMDB for movies/TV shows — returns multiple rich results."""
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    
    data = await request.json()
    query = data.get("query", "").strip()
    media_type = data.get("type", "multi")
    # [CR2-C1] Whitelist media_type to prevent path traversal against TMDB API
    if media_type not in ("multi", "movie", "tv"):
        media_type = "multi"
    if not query:
        return JSONResponse({"error": "Empty query"}, status_code=400)
    
    if not TMDB_API_KEY:
        return JSONResponse({"error": "TMDB_API_KEY not configured"}, status_code=500)
    
    import requests as http_req
    import urllib.parse
    try:
        # [CR2-C1] Use params dict to avoid key leaking in raw URL logs
        url = f"https://api.themoviedb.org/3/search/{media_type}"
        r = http_req.get(url, params={"api_key": TMDB_API_KEY, "query": query, "page": 1}, timeout=8)
        raw = r.json()
        
        results = []
        for item in (raw.get("results") or [])[:12]:
            mt = item.get("media_type", media_type)
            if mt == "person":
                continue
            
            title = item.get("title") or item.get("name") or ""
            year = ""
            rd = item.get("release_date") or item.get("first_air_date") or ""
            if rd:
                year = rd[:4]
            
            poster = f"https://image.tmdb.org/t/p/w342{item['poster_path']}" if item.get("poster_path") else ""
            backdrop = f"https://image.tmdb.org/t/p/w780{item['backdrop_path']}" if item.get("backdrop_path") else ""
            
            result = {
                "tmdb_id": item.get("id"),
                "title": title,
                "year": year,
                "media_type": mt,
                "poster": poster,
                "backdrop": backdrop,
                "rating": round(item.get("vote_average", 0), 1),
                "synopsis": item.get("overview", "")[:300],
                "popularity": item.get("popularity", 0),
            }
            
            # For TV, fetch season info
            if mt == "tv" and item.get("id"):
                try:
                    tv_url = f"https://api.themoviedb.org/3/tv/{item['id']}"
                    tv_r = http_req.get(tv_url, params={"api_key": TMDB_API_KEY}, timeout=5)
                    tv_data = tv_r.json()
                    seasons = []
                    for s in tv_data.get("seasons", []):
                        if s.get("season_number", 0) > 0:  # skip specials
                            seasons.append({
                                "number": s["season_number"],
                                "name": s.get("name", f"Season {s['season_number']}"),
                                "episodes": s.get("episode_count", 0),
                                "air_date": s.get("air_date", ""),
                            })
                    result["seasons"] = seasons
                    result["total_seasons"] = tv_data.get("number_of_seasons", 0)
                    result["status"] = tv_data.get("status", "")
                except Exception:
                    pass
            
            results.append(result)
        
        return JSONResponse({"results": results, "total": raw.get("total_results", 0)})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ═══════════════════════════════════════════════════════════════════
#  ULTRA PRO MAX: Smart Search → Filter → Forward Pipeline
# ═══════════════════════════════════════════════════════════════════

def _tmdb_lookup_with_seasons(query):
    """TMDB lookup that also fetches per-season episode counts."""
    import requests as http_req
    if not TMDB_API_KEY:
        return {}
    try:
        url = "https://api.themoviedb.org/3/search/multi"
        r = http_req.get(url, params={"api_key": TMDB_API_KEY, "query": query}, timeout=8)
        raw = r.json()
        results = raw.get("results", [])
        # Find best movie/tv match
        result = None
        for res in results:
            if res.get("media_type") in ["movie", "tv"]:
                result = res
                break
        if not result and results:
            result = results[0]
        if not result:
            return {}

        poster_path = result.get("poster_path")
        backdrop_path = result.get("backdrop_path")
        meta = {
            "poster_url": f"https://image.tmdb.org/t/p/w500{poster_path}" if poster_path else "",
            "backdrop_url": f"https://image.tmdb.org/t/p/w1280{backdrop_path}" if backdrop_path else "",
            "synopsis": result.get("overview", ""),
            "rating": result.get("vote_average", 0),
            "tmdb_title": result.get("title") or result.get("name") or query,
            "release_date": result.get("release_date") or result.get("first_air_date") or "",
            "tmdb_id": result.get("id"),
            "media_type": result.get("media_type", "movie"),
            "seasons": [],
        }
        # If TV, fetch season details
        if result.get("media_type") == "tv" and result.get("id"):
            try:
                tv_r = http_req.get(
                    f"https://api.themoviedb.org/3/tv/{result['id']}",
                    params={"api_key": TMDB_API_KEY}, timeout=5
                )
                tv_data = tv_r.json()
                for s in tv_data.get("seasons", []):
                    if s.get("season_number", 0) > 0:
                        meta["seasons"].append({
                            "season_number": s["season_number"],
                            "name": s.get("name", f"Season {s['season_number']}"),
                            "episode_count": s.get("episode_count", 0),
                            "air_date": s.get("air_date", ""),
                        })
            except Exception:
                pass
        return meta
    except Exception as e:
        print(f"TMDB season lookup error: {e}")
        return {}


@fastapi_app.post("/api/discover/search")
async def api_discover_search(request: Request):
    """V2: Multi-source smart search — Telegram + 7 external providers."""
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    data = await request.json()
    query = data.get("query", "").strip()
    if not query:
        return JSONResponse({"error": "Empty query"}, status_code=400)

    preferences = {
        "quality": data.get("quality", "1080p"),
        "language": data.get("language", ""),
        "seasons": data.get("seasons", []),
        "auto_select": False,
    }
    enabled_sources = data.get("enabled_sources", None)  # None = all, or ["telegram", "1337x", ...]
    media_type_hint = data.get("media_type", "all")  # "movie", "tv", "anime", "all"

    # Build combined search function
    async def search_fn(q):
        results = []
        tasks = []

        # 1. Telegram search (always included unless explicitly excluded)
        include_telegram = enabled_sources is None or "telegram" in enabled_sources
        if include_telegram:
            async def _telegram_search():
                tg_results = []
                if telegram_bot.userbot and telegram_bot.userbot.is_initialized:
                    try:
                        tg_results = await telegram_bot.search_global_files(q, limit=data.get("limit", 100))
                    except Exception as e:
                        print(f"Global search failed: {e}")
                try:
                    ch_results = await telegram_bot.search_source_channels(q, SOURCE_CHANNELS)
                    tg_results.extend(ch_results)
                except Exception as e:
                    print(f"Channel search failed: {e}")
                # Tag source
                for r in tg_results:
                    r["source_provider"] = "Telegram"
                return tg_results
            tasks.append(("telegram", _telegram_search()))

        # 2. External providers (concurrent)
        try:
            import multi_source
            external_sources = enabled_sources
            if external_sources and "telegram" in external_sources:
                external_sources = [s for s in external_sources if s != "telegram"]
            elif external_sources is None:
                external_sources = None  # = all providers

            async def _external_search():
                result = await multi_source.search_all_providers(
                    query=q,
                    media_type=media_type_hint,
                    enabled_providers=external_sources,
                    limit_per_provider=30,
                    timeout=8.0,
                )
                return result.get("results", []), result.get("provider_counts", {}), result.get("errors", {})
            tasks.append(("external", _external_search()))
        except ImportError:
            print("⚠️ multi_source module not available")

        # Run all concurrently
        provider_counts = {}
        provider_errors = {}
        
        if tasks:
            labels, coros = zip(*tasks)
            results_list = await asyncio.gather(*coros, return_exceptions=True)
            
            for label, res in zip(labels, results_list):
                if isinstance(res, Exception):
                    provider_errors[label] = str(res)[:200]
                else:
                    if label == "telegram":
                        results.extend(res)
                        provider_counts["telegram"] = len(res)
                    elif label == "external":
                        ext_res, ext_counts, ext_errors = res
                        results.extend(ext_res)
                        provider_counts.update(ext_counts)
                        provider_errors.update(ext_errors)

        return results, provider_counts, provider_errors

    # Don't require Telegram bot for external-only searches
    has_telegram = telegram_bot.app and telegram_bot.app.is_initialized
    only_external = enabled_sources and "telegram" not in enabled_sources
    if not has_telegram and not only_external:
        pass  # Allow search to proceed — external providers may still work

    try:
        # Run search
        raw_results, prov_counts, prov_errors = await search_fn(query)

        # Feed into smart_search pipeline
        result = await smart_search.smart_search(
            query=query,
            preferences=preferences,
            search_fn=lambda q: asyncio.coroutine(lambda: raw_results)() if False else _return_results(raw_results),
            tmdb_fn=lambda q: _tmdb_lookup_with_seasons(q),
        )

        # Augment result with provider info
        result["provider_counts"] = prov_counts
        result["provider_errors"] = prov_errors
        try:
            import multi_source
            result["available_providers"] = multi_source.get_provider_list()
        except ImportError:
            result["available_providers"] = []
        # Add Telegram to providers list
        result["available_providers"].insert(0, {
            "key": "telegram",
            "label": "Telegram",
            "emoji": "📱",
            "type": "general",
        })

        return JSONResponse(result)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse({"error": str(e)}, status_code=500)


async def _return_results(results):
    """Helper to return pre-fetched results as an async callable."""
    return results


@fastapi_app.post("/api/discover/forward")
async def api_discover_forward(request: Request):
    """Forward manually selected files to the ATMOS pipeline."""
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    data = await request.json()
    files = data.get("files", [])
    if not files:
        return JSONResponse({"error": "No files specified"}, status_code=400)
    if len(files) > 50:
        return JSONResponse({"error": "Max 50 files per batch"}, status_code=400)

    if not telegram_bot.app or not telegram_bot.app.is_initialized:
        return JSONResponse({"error": "Bot not running"}, status_code=503)

    async def pull_fn(chat_id, message_id, file_name):
        return await telegram_bot.pull_from_channel(chat_id, message_id, file_name)

    try:
        result = await smart_search.forward_to_pipeline(files, pull_fn, rate_limit=2.0)
        return JSONResponse({"success": True, **result})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@fastapi_app.post("/api/discover/auto-forward")
async def api_discover_auto_forward(request: Request):
    """Ultra Pro Max: Auto-search, auto-select best matches, auto-forward to pipeline."""
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    data = await request.json()
    query = data.get("query", "").strip()
    if not query:
        return JSONResponse({"error": "Empty query"}, status_code=400)

    preferences = {
        "quality": data.get("quality", "1080p"),
        "language": data.get("language", ""),
        "seasons": data.get("seasons", []),
        "auto_select": True,
    }

    async def search_fn(q):
        results = []
        if telegram_bot.userbot and telegram_bot.userbot.is_initialized:
            try:
                results = await telegram_bot.search_global_files(q, limit=data.get("limit", 100))
            except Exception:
                pass
        try:
            ch_results = await telegram_bot.search_source_channels(q, SOURCE_CHANNELS)
            results.extend(ch_results)
        except Exception:
            pass
        return results

    if not telegram_bot.app or not telegram_bot.app.is_initialized:
        return JSONResponse({"error": "Bot not running"}, status_code=503)

    try:
        # Phase 1: Smart search with auto-select
        search_result = await smart_search.smart_search(
            query=query,
            preferences=preferences,
            search_fn=search_fn,
            tmdb_fn=lambda q: _tmdb_lookup_with_seasons(q),
        )

        selected = search_result.get("selected", [])
        if not selected:
            return JSONResponse({
                "success": False,
                "message": "No files matched your criteria",
                "completeness": search_result.get("completeness", {}),
                "available_qualities": search_result.get("available_qualities", []),
                "available_languages": search_result.get("available_languages", []),
            })

        # Phase 2: Forward to pipeline
        async def pull_fn(chat_id, message_id, file_name):
            return await telegram_bot.pull_from_channel(chat_id, message_id, file_name)

        forward_result = await smart_search.forward_to_pipeline(selected, pull_fn, rate_limit=2.0)

        return JSONResponse({
            "success": True,
            "query": query,
            "media_type": search_result.get("media_type", ""),
            "tmdb_title": search_result.get("tmdb", {}).get("title", ""),
            **forward_result,
            "completeness": search_result.get("completeness", {}),
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse({"error": str(e)}, status_code=500)


@fastapi_app.post("/api/admin/channel-search")
async def api_channel_search(request: Request):
    """Search configured Telegram source channels for files matching a query."""
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    
    data = await request.json()
    query = data.get("query", "").strip()
    if not query:
        return JSONResponse({"error": "Empty query"}, status_code=400)
    
    if not telegram_bot.app or not telegram_bot.app.is_initialized:
        return JSONResponse({"error": "Bot not running"}, status_code=503)
    
    try:
        results = await telegram_bot.search_source_channels(query, SOURCE_CHANNELS)
        return JSONResponse({"results": results, "channels_searched": len(SOURCE_CHANNELS)})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@fastapi_app.post("/api/admin/pull")
async def api_admin_pull(request: Request):
    """Pull a file from a source channel into the download queue."""
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    
    data = await request.json()
    chat_id = data.get("chat_id")
    message_id = data.get("message_id")
    file_name = data.get("file_name", "")
    
    if not chat_id or not message_id:
        return JSONResponse({"error": "chat_id and message_id required"}, status_code=400)
    
    if not telegram_bot.app or not telegram_bot.app.is_initialized:
        return JSONResponse({"error": "Bot not running"}, status_code=503)
    
    try:
        result = await telegram_bot.pull_from_channel(int(chat_id), int(message_id), file_name)
        return JSONResponse({"success": True, **result})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@fastapi_app.post("/api/admin/pull-batch")
async def api_admin_pull_batch(request: Request):
    """Pull multiple files at once (e.g., full season)."""
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    
    data = await request.json()
    files = data.get("files", [])
    
    if not files:
        return JSONResponse({"error": "No files specified"}, status_code=400)
    
    # [H5] Cap batch size to prevent abuse
    MAX_BATCH_SIZE = 50
    if len(files) > MAX_BATCH_SIZE:
        return JSONResponse({"error": f"Batch too large. Maximum {MAX_BATCH_SIZE} files per request."}, status_code=400)
    
    if not telegram_bot.app or not telegram_bot.app.is_initialized:
        return JSONResponse({"error": "Bot not running"}, status_code=503)
    
    queued = 0
    errors = []
    for f in files:
        try:
            await telegram_bot.pull_from_channel(
                int(f["chat_id"]), int(f["message_id"]), f.get("file_name", "")
            )
            queued += 1
        except Exception as e:
            errors.append({"file": f.get("file_name", "?"), "error": str(e)})
    
    return JSONResponse({
        "success": True,
        "queued": queued,
        "errors": errors,
        "total": len(files)
    })


# ═══════════════════════════════════════════════════════════════════
#  V2: ENHANCED DISCOVER APIs
# ═══════════════════════════════════════════════════════════════════

def _dedup_results(results):
    """Quality-aware deduplication: group by episode, keep best quality per group."""
    QUALITY_RANK = {'2160p': 5, '4k': 5, '1080p': 4, '720p': 3, '480p': 2, '360p': 1, 'unknown': 0}
    
    groups = {}
    for r in results:
        ep = r.get('episode_info')
        if ep:
            key = f"S{ep.get('season', 0):02d}E{ep.get('episode', 0):02d}"
        else:
            # For movies, group by cleaned filename similarity
            key = re.sub(r'[^a-z0-9]', '', (r.get('file_name', '') or '').lower())[:40]
        
        if key not in groups:
            groups[key] = []
        groups[key].append(r)
    
    # For each group, sort by quality (best first), then size (largest first)
    deduped = []
    for key, group in groups.items():
        group.sort(key=lambda x: (
            QUALITY_RANK.get(x.get('quality', 'unknown'), 0),
            x.get('file_size', 0)
        ), reverse=True)
        deduped.extend(group)
    
    return deduped


@fastapi_app.post("/api/admin/channel-search-global")
async def api_channel_search_global(request: Request):
    """V2: Search ALL public Telegram using search_global (userbot required)."""
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    
    data = await request.json()
    query = data.get("query", "").strip()
    if not query:
        return JSONResponse({"error": "Empty query"}, status_code=400)
    
    if not telegram_bot.userbot or not telegram_bot.userbot.is_initialized:
        return JSONResponse({"error": "Userbot not running — required for global search"}, status_code=503)
    
    try:
        results = await telegram_bot.search_global_files(query, limit=data.get("limit", 50))
        results = _dedup_results(results)
        return JSONResponse({"results": results, "scope": "global", "total": len(results)})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@fastapi_app.get("/api/admin/source-channels")
async def api_get_source_channels(request: Request):
    """V2: List currently configured source channels."""
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    return JSONResponse({"channels": SOURCE_CHANNELS})


@fastapi_app.post("/api/admin/source-channels")
async def api_update_source_channels(request: Request):
    """V2: Add or remove source channels at runtime."""
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    
    data = await request.json()
    action = data.get("action", "add")
    channel = data.get("channel", "").strip()
    
    if not channel:
        return JSONResponse({"error": "Channel name required"}, status_code=400)
    
    global SOURCE_CHANNELS
    if action == "add":
        if channel not in SOURCE_CHANNELS:
            SOURCE_CHANNELS.append(channel)
            _save_channel_config()
        return JSONResponse({"success": True, "channels": SOURCE_CHANNELS, "action": "added"})
    elif action == "remove":
        if channel in SOURCE_CHANNELS:
            SOURCE_CHANNELS.remove(channel)
            _save_channel_config()
        return JSONResponse({"success": True, "channels": SOURCE_CHANNELS, "action": "removed"})
    else:
        return JSONResponse({"error": "Invalid action. Use 'add' or 'remove'."}, status_code=400)


# ═══════════════════════════════════════════════════════════════════
#  QUEUE MANAGEMENT APIs (Persistent Pipeline)
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/admin/queue")
async def api_admin_queue(request: Request):
    """Get full persistent queue state."""
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    return JSONResponse({
        "stats": pq.get_stats(),
        "jobs": pq.get_all()
    })

@fastapi_app.post("/api/admin/queue/retry/{job_id}")
async def api_admin_queue_retry(job_id: str, request: Request):
    """Manually retry a failed job."""
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    success = pq.retry_job(job_id)
    if success:
        return JSONResponse({"success": True, "message": f"Job {job_id} requeued"})
    return JSONResponse({"error": "Job not found or not in failed state"}, status_code=404)

@fastapi_app.post("/api/admin/queue/clear")
async def api_admin_queue_clear(request: Request):
    """Clear all completed and failed jobs."""
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    removed = pq.clear_finished()
    return JSONResponse({"success": True, "removed": removed})


# ═══════════════════════════════════════════════════════════════════
#  PHASE 5: Drive Explorer, Bulk Ops, Health, Activity, Scheduler, Trending
# ═══════════════════════════════════════════════════════════════════

# --- Activity Feed (in-memory ring buffer) ---
_activity_feed = deque(maxlen=200)
_server_start_time = time.time()

def log_activity(icon, text, category="info"):
    _activity_feed.appendleft({
        "icon": icon, "text": text, "category": category,
        "ts": time.strftime("%H:%M:%S"), "epoch": time.time()
    })

log_activity("🚀", "Server started", "system")

# --- Drive Explorer ---
@fastapi_app.get("/api/admin/drive/browse")
def api_drive_browse(request: Request, folder_id: str = ""):
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    if not GDRIVE_CREDENTIALS:
        return JSONResponse({"error": "Drive not configured"}, status_code=500)
    try:
        target = folder_id or GDRIVE_FOLDER_ID
        service = get_drive_service(GDRIVE_CREDENTIALS)
        q = f"'{target}' in parents and trashed = false"
        resp = service.files().list(
            q=q, fields="files(id,name,mimeType,size,modifiedTime)",
            orderBy="folder,name", pageSize=200
        ).execute()
        items = []
        for f in resp.get("files", []):
            is_folder = f["mimeType"] == "application/vnd.google-apps.folder"
            size_bytes = int(f.get("size", 0)) if not is_folder else 0
            items.append({
                "id": f["id"], "name": f["name"], "is_folder": is_folder,
                "size": _human_size(size_bytes) if size_bytes else "",
                "size_bytes": size_bytes,
                "modified": f.get("modifiedTime", "")[:10],
                "mime": f["mimeType"]
            })
        return JSONResponse({"files": items, "folder_id": target, "total": len(items)})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

@fastapi_app.post("/api/admin/drive/mkdir")
async def api_drive_mkdir(request: Request):
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    if not GDRIVE_CREDENTIALS:
        return JSONResponse({"error": "Drive not configured"}, status_code=500)
    data = await request.json()
    name = data.get("name", "").strip()
    parent = data.get("parent_id", GDRIVE_FOLDER_ID)
    if not name:
        return JSONResponse({"error": "Folder name required"}, status_code=400)
    try:
        service = get_drive_service(GDRIVE_CREDENTIALS)
        folder_id = get_or_create_folder(service, name, parent)
        log_activity("📁", f"Created folder: {name}", "drive")
        return JSONResponse({"success": True, "folder_id": folder_id, "name": name})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

@fastapi_app.post("/api/admin/drive/move")
async def api_drive_move(request: Request):
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    if not GDRIVE_CREDENTIALS:
        return JSONResponse({"error": "Drive not configured"}, status_code=500)
    data = await request.json()
    file_id = data.get("file_id", "")
    new_parent = data.get("new_parent_id", "")
    if not file_id or not new_parent:
        return JSONResponse({"error": "file_id and new_parent_id required"}, status_code=400)
    if not re.match(r'^[a-zA-Z0-9_-]+$', file_id):
        return JSONResponse({"error": "Invalid file ID"}, status_code=400)
    try:
        service = get_drive_service(GDRIVE_CREDENTIALS)
        f = service.files().get(fileId=file_id, fields="parents").execute()
        old_parents = ",".join(f.get("parents", []))
        service.files().update(
            fileId=file_id, addParents=new_parent,
            removeParents=old_parents, fields="id,parents"
        ).execute()
        log_activity("📦", f"Moved file {file_id}", "drive")
        return JSONResponse({"success": True})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

# --- Bulk Operations ---
@fastapi_app.post("/api/admin/bulk/rename")
async def api_bulk_rename(request: Request):
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    if not GDRIVE_CREDENTIALS:
        return JSONResponse({"error": "Drive not configured"}, status_code=500)
    data = await request.json()
    renames = data.get("renames", [])  # [{id, new_name}]
    if not renames or len(renames) > 100:
        return JSONResponse({"error": "Provide 1-100 renames"}, status_code=400)
    success, errors = 0, []
    for r in renames:
        try:
            rename_file(GDRIVE_CREDENTIALS, r["id"], r["new_name"])
            success += 1
        except Exception as e:
            errors.append({"id": r.get("id"), "error": str(e)})
    log_activity("✏️", f"Bulk renamed {success} files", "bulk")
    return JSONResponse({"success": success, "errors": errors})

@fastapi_app.post("/api/admin/bulk/delete")
async def api_bulk_delete(request: Request):
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    if not GDRIVE_CREDENTIALS:
        return JSONResponse({"error": "Drive not configured"}, status_code=500)
    data = await request.json()
    file_ids = data.get("file_ids", [])
    if not file_ids or len(file_ids) > 100:
        return JSONResponse({"error": "Provide 1-100 file IDs"}, status_code=400)
    success, errors = 0, []
    for fid in file_ids:
        if not re.match(r'^[a-zA-Z0-9_-]+$', fid):
            errors.append({"id": fid, "error": "Invalid ID"})
            continue
        try:
            delete_file(GDRIVE_CREDENTIALS, fid)
            success += 1
        except Exception as e:
            errors.append({"id": fid, "error": str(e)})
    log_activity("🗑️", f"Bulk deleted {success} files", "bulk")
    return JSONResponse({"success": success, "errors": errors})

# --- Health Monitor ---
@fastapi_app.get("/api/admin/health")
def api_admin_health(request: Request):
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    health = {"cpu_percent": 0, "memory_percent": 0, "memory_used": "", "memory_total": "",
              "disk_percent": 0, "disk_used": "", "disk_total": "", "uptime_seconds": 0,
              "python_version": sys.version.split()[0], "platform": sys.platform}
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
    # API latency self-test
    t0 = time.time()
    try:
        import urllib.request
        urllib.request.urlopen(f"http://localhost:7860/api/videos", timeout=3)
    except Exception:
        pass
    health["api_latency_ms"] = round((time.time() - t0) * 1000)
    return JSONResponse(health)

# --- TMDB Trending (for Discover panel) ---
@fastapi_app.get("/api/admin/tmdb/trending")
def api_admin_tmdb_trending(request: Request):
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    tmdb_key = os.environ.get("TMDB_API_KEY", "")
    if not tmdb_key:
        return JSONResponse({"results": []})
    try:
        import requests as _req
        r = _req.get(f"https://api.themoviedb.org/3/trending/all/week", params={"api_key": tmdb_key}, timeout=10)
        if r.status_code == 200:
            return JSONResponse({"results": r.json().get("results", [])[:20]})
    except Exception as e:
        print(f"TMDB trending error: {e}")
    return JSONResponse({"results": []})

# --- Transfer History ---
@fastapi_app.get("/api/admin/history")
def api_admin_history(request: Request):
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    completed = [t.to_dict() for t in tm.completed[:50]] if hasattr(tm, 'completed') else []
    failed = [t.to_dict() for t in tm.failed[:50]] if hasattr(tm, 'failed') else []
    return JSONResponse({"history": completed + failed, "transfers": completed + failed})

# --- Activity Feed ---
@fastapi_app.get("/api/admin/activity")
def api_admin_activity(request: Request):
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    limit = int(request.query_params.get("limit", 50))
    return JSONResponse({"events": list(_activity_feed)[:limit]})

# --- Scheduler (persistent JSON-based) ---
_SCHEDULER_FILE = "schedules.json"

def _load_schedules():
    if os.path.exists(_SCHEDULER_FILE):
        try:
            with open(_SCHEDULER_FILE) as f:
                return json.load(f)
        except Exception:
            pass
    return []

def _save_schedules(schedules):
    try:
        with open(_SCHEDULER_FILE, "w") as f:
            json.dump(schedules, f)
    except Exception:
        pass

@fastapi_app.get("/api/admin/schedules")
def api_get_schedules(request: Request):
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    return JSONResponse({"schedules": _load_schedules()})

@fastapi_app.post("/api/admin/schedules")
async def api_save_schedule(request: Request):
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    data = await request.json()
    schedules = _load_schedules()
    entry = {
        "id": f"sched_{int(time.time())}",
        "channel": data.get("channel", ""),
        "query": data.get("query", ""),
        "interval": int(data.get("interval", 86400)),
        "quality": data.get("quality", "all"),
        "enabled": True,
        "created": time.strftime("%Y-%m-%d %H:%M"),
        "last_run": None
    }
    schedules.append(entry)
    _save_schedules(schedules)
    log_activity("📅", f"Schedule created: {entry['query']} on {entry['channel']}", "scheduler")
    return JSONResponse({"success": True, "schedule": entry})

@fastapi_app.post("/api/admin/schedules/delete")
async def api_delete_schedule(request: Request):
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    data = await request.json()
    sid = data.get("id", "")
    schedules = [s for s in _load_schedules() if s.get("id") != sid]
    _save_schedules(schedules)
    return JSONResponse({"success": True})

# --- TMDB Trending ---
@fastapi_app.get("/api/admin/tmdb/trending")
def api_tmdb_trending(request: Request):
    if not check_admin_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    if not TMDB_API_KEY:
        return JSONResponse({"error": "TMDB_API_KEY not configured"}, status_code=500)
    media = request.query_params.get("media", "all")
    window = request.query_params.get("window", "week")
    if media not in ("all", "movie", "tv"):
        media = "all"
    if window not in ("day", "week"):
        window = "week"
    import requests as http_req
    try:
        r = http_req.get(
            f"https://api.themoviedb.org/3/trending/{media}/{window}",
            params={"api_key": TMDB_API_KEY}, timeout=8
        )
        raw = r.json()
        results = []
        for item in (raw.get("results") or [])[:20]:
            mt = item.get("media_type", media)
            if mt == "person":
                continue
            title = item.get("title") or item.get("name") or ""
            rd = item.get("release_date") or item.get("first_air_date") or ""
            poster = f"https://image.tmdb.org/t/p/w342{item['poster_path']}" if item.get("poster_path") else ""
            backdrop = f"https://image.tmdb.org/t/p/w780{item['backdrop_path']}" if item.get("backdrop_path") else ""
            results.append({
                "tmdb_id": item.get("id"), "title": title, "year": rd[:4] if rd else "",
                "media_type": mt, "poster": poster, "backdrop": backdrop,
                "rating": round(item.get("vote_average", 0), 1),
                "synopsis": (item.get("overview") or "")[:300],
                "popularity": item.get("popularity", 0)
            })
        return JSONResponse({"results": results, "media": media, "window": window})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ═══════════════════════════════════════════════════════════════════
#  Root Redirects
# ═══════════════════════════════════════════════════════════════════

# ─── Torrent multi-source search ─────────────────────────────────
@fastapi_app.get("/api/torrent-search")
async def api_torrent_search(
    q: str,
    quality: str = "1080p",
    type: str = "auto",
    season: Optional[int] = None,
    episode: Optional[int] = None,
):
    try:
        result = await torrent_search.search_all(
            query=q, quality=quality, media_type=type,
            season=season, episode=episode,
        )
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

# ═══════════════════════════════════════════════════════════════════

@fastapi_app.get("/")
async def root():
    return RedirectResponse("http://atmos.page.gd")

@fastapi_app.get("/admin")
async def admin_redirect():
    return RedirectResponse("http://atmos.page.gd/admin.html")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(fastapi_app, host="0.0.0.0", port=7860)
