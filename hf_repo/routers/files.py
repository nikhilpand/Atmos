"""Files Router — /api/files, /api/videos, /api/stream, /api/tracks, /api/subtitle"""

import os
import re
import asyncio
import time
import threading
import concurrent.futures
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse, Response

import metadata_fetcher
from media_classifier import MediaClassifier
from gdrive_uploader import get_drive_service, list_drive_folder
from transfer_manager import TransferManager
from utils.human_size import human_size as _human_size

router = APIRouter()

GDRIVE_CREDENTIALS = os.environ.get("GDRIVE_CREDENTIALS", "")
GDRIVE_FOLDER_ID = os.environ.get("GDRIVE_FOLDER_ID", "")
MEDIA_SERVER_URL = os.environ.get("MEDIA_SERVER_URL", "https://nikhil1776-atmos-media.hf.space")

tm = TransferManager()

# ─── Analytics ───────────────────────────────────────────────────
import json
ANALYTICS_FILE = "analytics.json"
_analytics_lock = threading.Lock()
_tl_stream = threading.local()


def load_analytics():
    if os.path.exists(ANALYTICS_FILE):
        try:
            with open(ANALYTICS_FILE, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return {"total_views": 0, "stream_starts": 0}


def save_analytics(data):
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

# ─── Video cache ─────────────────────────────────────────────────
_video_cache = {"data": None, "timestamp": 0}
_video_cache_lock = threading.Lock()
CACHE_TTL = 300
_background_refresh_active = False


def _parse_quality(filename):
    fn = filename.lower()
    if '2160p' in fn or '4k' in fn: return '4K'
    if '1080p' in fn: return '1080p'
    if '720p' in fn: return '720p'
    if '480p' in fn: return '480p'
    return ''


def _process_single_video(f):
    name = f.get('name', '')
    mime = f.get('mimeType', '')
    parsed = MediaClassifier.parse(name)
    title = parsed.get("title")
    year = parsed.get("year")
    m_type = "tv" if parsed["type"] in ["show", "anime"] else "movie"
    folder_path = f.get('folder_path', '')
    folder_parts = [p.strip() for p in folder_path.split('/') if p.strip()]
    drive_show_title = ""
    drive_season = None
    if len(folder_parts) >= 2 and folder_parts[0].lower() == "tv shows":
        drive_show_title = folder_parts[1]
        if len(folder_parts) >= 3 and "season" in folder_parts[2].lower():
            try:
                drive_season = int(re.search(r'\d+', folder_parts[2]).group())
            except Exception:
                pass
    if drive_show_title:
        m_type = "tv"
    search_title = drive_show_title or title
    meta = metadata_fetcher.get_metadata(search_title, year=year, media_type=m_type)
    video_obj = {
        "id": f['id'], "name": name,
        "size": f.get('size_human', '—'), "size_bytes": f.get('size_bytes', 0),
        "modified": f.get('modifiedTime', '')[:10], "mime": mime,
        "stream_url": f"/api/stream/{f.get('id')}", "folder_path": folder_path,
        "thumbnail_url": f.get('thumbnail_url', ''),
        "poster_url": meta.get("poster_url") or f.get('thumbnail_url', ''),
        "backdrop_url": meta.get("backdrop_url") or meta.get("poster_url") or f.get('thumbnail_url', ''),
        "title": meta.get("tmdb_title") or title,
        "year": meta.get("release_date")[:4] if meta.get("release_date") else (str(year) if year else ""),
        "rating": meta.get("rating", 0), "synopsis": meta.get("synopsis", ""),
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
        files = list_drive_folder(GDRIVE_CREDENTIALS, GDRIVE_FOLDER_ID, page_size=500, recursive=True)
        video_extensions = {'.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv', '.m4v', '.ts'}
        valid_files = [f for f in files
                       if os.path.splitext(f.get('name', ''))[1].lower() in video_extensions
                       or 'video' in f.get('mimeType', '')]
        videos = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            for video_obj in executor.map(_process_single_video, valid_files):
                videos.append(video_obj)
        response_data = {
            "videos": videos, "total": len(videos), "cached": False,
            "media_base_url": MEDIA_SERVER_URL,
        }
        with _video_cache_lock:
            _video_cache = {"data": response_data, "timestamp": time.time()}
    except Exception as e:
        print(f"Error in background fetch: {e}")
    finally:
        with _video_cache_lock:
            _background_refresh_active = False


@router.get("/api/files")
@router.get("/api/videos")
def api_get_videos(force_refresh: bool = False):
    global _video_cache, _background_refresh_active
    if not GDRIVE_CREDENTIALS:
        return JSONResponse({"error": "Drive not configured", "videos": []}, status_code=500)
    now = time.time()
    trigger_bg_refresh = False
    with _video_cache_lock:
        cache_valid = _video_cache["data"] and (now - _video_cache["timestamp"] < CACHE_TTL)
        if force_refresh or not cache_valid:
            if not _video_cache["data"]:
                trigger_bg_refresh = False
            elif not _background_refresh_active:
                trigger_bg_refresh = True
                _background_refresh_active = True
    if trigger_bg_refresh:
        threading.Thread(target=_fetch_videos_from_drive, daemon=True).start()
        with _video_cache_lock:
            resp_data = dict(_video_cache["data"])
            resp_data["cached"] = True
            return JSONResponse(resp_data)
    if force_refresh or not _video_cache["data"] or not cache_valid:
        with _video_cache_lock:
            _background_refresh_active = True
        _fetch_videos_from_drive()
    with _video_cache_lock:
        return JSONResponse(_video_cache["data"])


# ═══════════════════════════════════════════════════════════════════
#  Streaming Proxy (with Range Request support)
# ═══════════════════════════════════════════════════════════════════

@router.get("/api/stream/{file_id}")
@router.head("/api/stream/{file_id}")
async def stream_video(file_id: str, request: Request):
    if not re.match(r'^[a-zA-Z0-9_-]+$', file_id):
        return JSONResponse({"error": "Invalid file ID"}, status_code=400)
    if not request.headers.get('range') or request.headers.get('range') == 'bytes=0-':
        with _analytics_lock:
            app_analytics["stream_starts"] += 1
            save_analytics(app_analytics)
    if not GDRIVE_CREDENTIALS:
        return JSONResponse({"error": "Not configured"}, status_code=500)
    try:
        service = get_drive_service(GDRIVE_CREDENTIALS)
        file_meta = service.files().get(fileId=file_id, fields="name,size,mimeType").execute()
        file_size = int(file_meta.get('size', 0))
        mime_type = file_meta.get('mimeType', 'video/mp4')
        if 'matroska' in mime_type.lower() or mime_type == 'application/octet-stream':
            mime_type = 'video/webm'
        if request.method == "HEAD":
            return Response(status_code=200, headers={
                'Content-Length': str(file_size), 'Accept-Ranges': 'bytes',
                'Content-Type': mime_type, 'Cache-Control': 'public, max-age=3600',
            })
        download_url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media"
        from google.auth.transport.requests import AuthorizedSession
        creds = service._http.credentials
        if not hasattr(_tl_stream, 'session') or _tl_stream.creds_id != id(creds):
            _tl_stream.session = AuthorizedSession(creds)
            _tl_stream.creds_id = id(creds)
        session = _tl_stream.session
        range_header = request.headers.get('range', '')
        if range_header:
            match = re.match(r'bytes=(\d+)-(\d*)', range_header)
            if not match:
                return Response(status_code=400)
            start = int(match.group(1))
            end = int(match.group(2)) if match.group(2) else min(start + 2 * 1024 * 1024 - 1, file_size - 1)
            end = min(end, file_size - 1)
            chunk_size = end - start + 1
            resp = await asyncio.to_thread(session.get, download_url, headers={'Range': f'bytes={start}-{end}'}, stream=True)
            if resp.status_code == 403:
                return JSONResponse({"error": "Google Drive Download Quota Exceeded."}, status_code=429)
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
            return StreamingResponse(iterchunks(), status_code=206, media_type=mime_type, headers={
                'Content-Range': f'bytes {start}-{end}/{file_size}',
                'Content-Length': str(chunk_size), 'Accept-Ranges': 'bytes',
                'Cache-Control': 'public, max-age=3600',
            })
        else:
            resp = await asyncio.to_thread(session.get, download_url, stream=True)
            if resp.status_code == 403:
                return JSONResponse({"error": "Google Drive Download Quota Exceeded."}, status_code=429)
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
            return StreamingResponse(iterchunks(), status_code=200, media_type=mime_type, headers={
                'Content-Length': str(file_size), 'Accept-Ranges': 'bytes',
                'Cache-Control': 'public, max-age=3600',
            })
    except Exception as e:
        print(f"Stream error: {e}")
        return JSONResponse({"error": str(e)[:300]}, status_code=500)


# ═══════════════════════════════════════════════════════════════════
#  Track Detection & Subtitle Extraction
# ═══════════════════════════════════════════════════════════════════

def _get_ffprobe_path():
    import shutil
    path = shutil.which("ffprobe")
    if path:
        return path
    try:
        import imageio_ffmpeg
        ff = imageio_ffmpeg.get_ffmpeg_exe()
        probe = ff.replace("ffmpeg", "ffprobe")
        if os.path.exists(probe):
            return probe
    except ImportError:
        pass
    return None


def _get_ffmpeg_path():
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


_subtitle_cache = {}


@router.get("/api/tracks/{file_id}")
async def get_tracks(file_id: str, request: Request):
    if not re.match(r'^[a-zA-Z0-9_-]+$', file_id):
        return JSONResponse({"error": "Invalid file ID"}, status_code=400)
    ffprobe = _get_ffprobe_path()
    if not ffprobe:
        return JSONResponse({"error": "ffprobe not available"}, status_code=501)
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
        cmd = [ffprobe, "-v", "quiet", "-print_format", "json", "-show_streams",
               "-headers", f"Authorization: Bearer {access_token}\r\n", download_url]
        result = await asyncio.to_thread(subprocess.run, cmd, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            return JSONResponse({"error": "ffprobe failed", "stderr": result.stderr[:300]}, status_code=500)
        import json as _json
        probe_data = _json.loads(result.stdout)
        streams = probe_data.get("streams", [])
        audio_tracks, subtitle_tracks = [], []
        audio_idx, sub_idx = 0, 0
        for s in streams:
            codec_type = s.get("codec_type", "")
            tags = s.get("tags", {})
            lang = tags.get("language", tags.get("LANGUAGE", ""))
            title = tags.get("title", tags.get("TITLE", ""))
            label = title or lang or ""
            if codec_type == "audio":
                audio_tracks.append({
                    "index": s.get("index"), "stream_index": audio_idx,
                    "language": lang, "label": label or f"Audio {audio_idx + 1}",
                    "codec": s.get("codec_name", ""), "channels": s.get("channels", 2),
                    "default": s.get("disposition", {}).get("default", 0) == 1,
                })
                audio_idx += 1
            elif codec_type == "subtitle":
                subtitle_tracks.append({
                    "index": s.get("index"), "stream_index": sub_idx,
                    "language": lang, "lang_code": lang[:2] if lang else "un",
                    "label": label or lang or f"Subtitle {sub_idx + 1}",
                    "codec": s.get("codec_name", ""),
                    "forced": s.get("disposition", {}).get("forced", 0) == 1,
                    "default": s.get("disposition", {}).get("default", 0) == 1,
                })
                sub_idx += 1
        return JSONResponse({"audio_tracks": audio_tracks, "subtitle_tracks": subtitle_tracks})
    except asyncio.TimeoutError:
        return JSONResponse({"error": "ffprobe timed out"}, status_code=504)
    except Exception as e:
        print(f"Track probe error: {e}")
        return JSONResponse({"error": str(e)[:300]}, status_code=500)


@router.get("/api/subtitle/{file_id}/{track_index}")
async def get_subtitle(file_id: str, track_index: int, request: Request):
    if not re.match(r'^[a-zA-Z0-9_-]+$', file_id):
        return JSONResponse({"error": "Invalid file ID"}, status_code=400)
    if track_index < 0 or track_index > 50:
        return JSONResponse({"error": "Invalid track index"}, status_code=400)
    cache_key = f"{file_id}:{track_index}"
    if cache_key in _subtitle_cache:
        return Response(content=_subtitle_cache[cache_key], media_type="text/vtt",
                        headers={"Cache-Control": "public, max-age=86400"})
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
        cmd = [ffmpeg, "-v", "quiet", "-headers", f"Authorization: Bearer {access_token}\r\n",
               "-i", download_url, "-map", f"0:s:{track_index}", "-f", "webvtt", "pipe:1"]
        result = await asyncio.to_thread(subprocess.run, cmd, capture_output=True, timeout=60)
        if result.returncode != 0:
            stderr = result.stderr.decode("utf-8", errors="replace")[:300]
            return JSONResponse({"error": "Subtitle extraction failed", "stderr": stderr}, status_code=500)
        vtt_data = result.stdout
        if not vtt_data or len(vtt_data) < 10:
            return JSONResponse({"error": "Empty subtitle track"}, status_code=404)
        _subtitle_cache[cache_key] = vtt_data
        return Response(content=vtt_data, media_type="text/vtt",
                        headers={"Cache-Control": "public, max-age=86400"})
    except asyncio.TimeoutError:
        return JSONResponse({"error": "Subtitle extraction timed out"}, status_code=504)
    except Exception as e:
        print(f"Subtitle extraction error: {e}")
        return JSONResponse({"error": str(e)[:300]}, status_code=500)
