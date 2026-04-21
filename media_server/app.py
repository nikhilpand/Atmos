"""
ATMOS Media Server — Dedicated Video Streaming, Remux, Audio & Subtitles
Runs as a separate HuggingFace Space for dedicated media processing.

Endpoints:
  GET /stream/{file_id}                — Stream with on-the-fly MKV→fMP4 remux
  GET /stream/{file_id}?audio_track=N  — Stream selecting specific audio track
  GET /tracks/{file_id}                — Probe audio/subtitle track metadata
  GET /subtitle/{file_id}/{idx}        — Extract embedded subtitle as WebVTT
  GET /subtitles/search                — Search external subtitle providers
  GET /health                          — Health check
"""

import os
import re
import sys
import json
import time
import shutil
import asyncio
import hashlib
import logging
import subprocess
import threading
from io import BytesIO
from collections import OrderedDict
from typing import Optional

from fastapi import FastAPI, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse, Response
from contextlib import asynccontextmanager

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ═══════════════════════════════════════════════════════════════════
#  Configuration
# ═══════════════════════════════════════════════════════════════════

GDRIVE_CREDENTIALS = os.environ.get("GDRIVE_CREDENTIALS", "")
CORS_ORIGINS = os.environ.get(
    "CORS_ORIGINS",
    "https://atmos.page.gd,https://sway.page.gd,http://localhost:3000"
).split(",")

# ═══════════════════════════════════════════════════════════════════
#  App Init
# ═══════════════════════════════════════════════════════════════════

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield

app = FastAPI(title="ATMOS Media Server", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Range", "Accept-Ranges", "Content-Length"],
)

# ═══════════════════════════════════════════════════════════════════
#  Google Drive Service (reused from main server)
# ═══════════════════════════════════════════════════════════════════

_creds_cache = None
_drive_lock = threading.Lock()
_thread_local = threading.local()

SCOPES = ["https://www.googleapis.com/auth/drive"]


def get_drive_service(creds_json: str):
    """
    Build or reuse a Google Drive service from OAuth user credentials.
    Handles automatic token refresh when access token expires.
    Matches main app's auth pattern exactly.
    """
    global _creds_cache
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request as AuthRequest
    from googleapiclient.discovery import build

    # Fast path: valid cached creds + thread-local service
    if _creds_cache and _creds_cache.valid and hasattr(_thread_local, "service"):
        return _thread_local.service

    with _drive_lock:
        # Re-check after lock
        if _creds_cache and _creds_cache.valid and hasattr(_thread_local, "service"):
            return _thread_local.service

        # Refresh expired token
        if _creds_cache and _creds_cache.expired and _creds_cache.refresh_token:
            print("🔄 Refreshing expired OAuth token...")
            _creds_cache.refresh(AuthRequest())
            _thread_local.service = build("drive", "v3", credentials=_creds_cache)
            print("✅ Token refreshed.")
            return _thread_local.service

        # Build from JSON
        creds_data = json.loads(creds_json)
        creds = Credentials.from_authorized_user_info(creds_data, SCOPES)

        if creds.expired and creds.refresh_token:
            print("🔄 Access token expired, refreshing...")
            creds.refresh(AuthRequest())
            print("✅ Token refreshed.")

        _creds_cache = creds
        service = build("drive", "v3", credentials=creds)
        _thread_local.service = service
        return service


def _get_auth_session():
    """Get an authenticated requests session for Drive API."""
    from google.auth.transport.requests import AuthorizedSession, Request as AuthRequest
    service = get_drive_service(GDRIVE_CREDENTIALS)
    creds = _creds_cache
    with _drive_lock:
        if creds.expired:
            creds.refresh(AuthRequest())
    session = AuthorizedSession(creds)
    return session, creds.token


# ═══════════════════════════════════════════════════════════════════
#  FFmpeg / FFprobe Helpers
# ═══════════════════════════════════════════════════════════════════

def _get_ffprobe_path():
    return shutil.which("ffprobe")


def _get_ffmpeg_path():
    return shutil.which("ffmpeg")


# File metadata cache: { file_id: { meta, timestamp } }
_file_meta_cache = OrderedDict()
_META_CACHE_TTL = 300  # 5 minutes
_META_CACHE_MAX = 100


def _get_file_meta(file_id: str):
    """Get file metadata from Drive with caching."""
    now = time.time()
    if file_id in _file_meta_cache:
        entry = _file_meta_cache[file_id]
        if now - entry["timestamp"] < _META_CACHE_TTL:
            return entry["meta"]

    service = get_drive_service(GDRIVE_CREDENTIALS)
    meta = service.files().get(
        fileId=file_id, fields="name,size,mimeType"
    ).execute()

    # Evict old entries
    while len(_file_meta_cache) >= _META_CACHE_MAX:
        _file_meta_cache.popitem(last=False)

    _file_meta_cache[file_id] = {"meta": meta, "timestamp": now}
    return meta


# Track probe cache: { file_id: { data, timestamp } }
_track_cache = OrderedDict()
_TRACK_CACHE_TTL = 600  # 10 minutes


def _needs_remux(file_meta: dict) -> bool:
    """Check if file needs MKV→fMP4 remux based on MIME type."""
    mime = file_meta.get("mimeType", "")
    name = file_meta.get("name", "")
    return (
        "matroska" in mime.lower()
        or mime == "application/octet-stream"
        or name.lower().endswith(".mkv")
    )


# ═══════════════════════════════════════════════════════════════════
#  Subtitle Cache
# ═══════════════════════════════════════════════════════════════════

_subtitle_cache = OrderedDict()
_SUB_CACHE_MAX = 50

# External subtitle cache (subliminal results)
_ext_subtitle_cache = OrderedDict()
_EXT_SUB_CACHE_MAX = 30


# ═══════════════════════════════════════════════════════════════════
#  ENDPOINT: Health
# ═══════════════════════════════════════════════════════════════════

@app.get("/health")
def health_check():
    ffmpeg_ok = _get_ffmpeg_path() is not None
    ffprobe_ok = _get_ffprobe_path() is not None
    drive_ok = bool(GDRIVE_CREDENTIALS)
    return {
        "status": "ok" if (ffmpeg_ok and drive_ok) else "degraded",
        "ffmpeg": ffmpeg_ok,
        "ffprobe": ffprobe_ok,
        "drive_configured": drive_ok,
        "version": "1.0.0",
    }



# ═══════════════════════════════════════════════════════════════════
#  ENDPOINT: Stream Video (with remux + audio track selection)
# ═══════════════════════════════════════════════════════════════════

@app.get("/stream/{file_id}")
@app.head("/stream/{file_id}")
async def stream_video(
    file_id: str,
    request: Request,
    audio_track: Optional[int] = Query(None, description="Audio track index (0-based)"),
    format: Optional[str] = Query(None, description="Force output format: mp4"),
    start: float = Query(0.0, description="Start timestamp in seconds"),
):
    """
    Smart video streaming with automatic MKV→fragmented-MP4 remux.

    - MP4 files: direct proxy with Range support (zero overhead)
    - MKV files: on-the-fly remux to fragmented MP4 via ffmpeg
    - audio_track param: select which audio track to include
    """
    if not re.match(r'^[a-zA-Z0-9_-]+$', file_id):
        return JSONResponse({"error": "Invalid file ID"}, status_code=400)

    if not GDRIVE_CREDENTIALS:
        return JSONResponse({"error": "Drive not configured"}, status_code=500)

    try:
        file_meta = _get_file_meta(file_id)
        file_size = int(file_meta.get("size", 0))
        mime_type = file_meta.get("mimeType", "video/mp4")
        needs_remux = _needs_remux(file_meta) or format == "mp4"

        if needs_remux or audio_track is not None or start > 0:
            # ── Remux path: MKV → fragmented MP4 via ffmpeg ──
            return await _stream_remuxed(file_id, file_meta, audio_track, start, request)
        else:
            # ── Direct proxy path: MP4 with Range support ──
            return await _stream_direct(file_id, file_meta, request)

    except Exception as e:
        print(f"Stream error: {e}")
        return JSONResponse({"error": str(e)[:300]}, status_code=500)


async def _stream_direct(file_id: str, file_meta: dict, request: Request):
    """Direct proxy for MP4 files — supports Range requests for seeking."""
    file_size = int(file_meta.get("size", 0))
    mime_type = file_meta.get("mimeType", "video/mp4")
    download_url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media"
    session, _ = _get_auth_session()

    if request.method == "HEAD":
        return Response(
            status_code=200,
            headers={
                "Content-Length": str(file_size),
                "Accept-Ranges": "bytes",
                "Content-Type": mime_type,
                "Cache-Control": "public, max-age=3600",
            }
        )

    range_header = request.headers.get("range", "")

    if range_header:
        match = re.match(r"bytes=(\d+)-(\d*)", range_header)
        if not match:
            return Response(status_code=400)

        start = int(match.group(1))
        # 2MB chunks for smoother playback
        end = int(match.group(2)) if match.group(2) else min(start + 2 * 1024 * 1024 - 1, file_size - 1)
        end = min(end, file_size - 1)
        chunk_size = end - start + 1

        resp = await asyncio.to_thread(
            session.get, 
            download_url, 
            headers={"Range": f"bytes={start}-{end}"}, 
            stream=True
        )

        if resp.status_code == 403:
            return JSONResponse({"error": "Drive quota exceeded"}, status_code=429)
        elif resp.status_code >= 400:
            return JSONResponse({"error": f"Upstream error: {resp.status_code}"}, status_code=502)

        async def iter_chunks():
            try:
                iterator = resp.iter_content(chunk_size=1024 * 1024)
                while True:
                    chunk = await asyncio.to_thread(next, iterator, None)
                    if not chunk:
                        break
                    yield chunk
            finally:
                resp.close()

        return StreamingResponse(
            iter_chunks(),
            status_code=206,
            media_type=mime_type,
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Content-Length": str(chunk_size),
                "Accept-Ranges": "bytes",
                "Cache-Control": "public, max-age=3600",
            }
        )
    else:
        resp = await asyncio.to_thread(
            session.get,
            download_url, 
            stream=True
        )
        if resp.status_code == 403:
            return JSONResponse({"error": "Drive quota exceeded"}, status_code=429)
        elif resp.status_code >= 400:
            return JSONResponse({"error": f"Upstream: {resp.status_code}"}, status_code=502)

        async def iter_chunks():
            try:
                iterator = resp.iter_content(chunk_size=1024 * 1024)
                while True:
                    chunk = await asyncio.to_thread(next, iterator, None)
                    if not chunk:
                        break
                    yield chunk
            finally:
                resp.close()

        return StreamingResponse(
            iter_chunks(),
            status_code=200,
            media_type=mime_type,
            headers={
                "Content-Length": str(file_size),
                "Accept-Ranges": "bytes",
                "Cache-Control": "public, max-age=3600",
            }
        )


async def _stream_remuxed(
    file_id: str,
    file_meta: dict,
    audio_track: Optional[int],
    start_time: float,
    request: Request,
):
    """
    On-the-fly MKV → fragmented MP4 remux via ffmpeg.

    Key design:
    - `-c:v copy` → no video re-encoding (instant, zero CPU)
    - `-c:a aac` → transcode audio to browser-compatible AAC
    - `-movflags frag_keyframe+empty_moov+default_base_moof` → fragmented MP4 for streaming
    - Selects specific audio track via `-map 0:a:{N}`
    """
    ffmpeg = _get_ffmpeg_path()
    if not ffmpeg:
        return JSONResponse({"error": "ffmpeg not available"}, status_code=501)

    download_url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media"
    _, access_token = _get_auth_session()

    # Build ffmpeg command
    audio_map = f"0:a:{audio_track}" if audio_track is not None else "0:a:0"

    cmd = [
        ffmpeg,
        "-hide_banner",
        "-loglevel", "error",
        "-reconnect", "1",
        "-reconnect_streamed", "1",
        "-reconnect_delay_max", "5",
        "-headers", f"Authorization: Bearer {access_token}\r\n"
    ]
    
    if start_time > 0:
        cmd += ["-ss", str(start_time)]
        
    cmd += [
        "-i", download_url,
        "-map", "0:v:0",       # first video stream
        "-map", audio_map,      # selected audio stream
        "-c:v", "copy",         # copy video codec (no re-encode)
        "-c:a", "aac",          # transcode audio to AAC for browser compat
        "-b:a", "192k",         # good quality audio
        "-ac", "2",             # stereo (browser-safe)
        "-max_muxing_queue_size", "1024", # prevent dropped frames during remux
        "-movflags", "frag_keyframe+empty_moov+default_base_moof"
    ]
    
    if start_time > 0:
        cmd += ["-output_ts_offset", str(start_time)]
        
    cmd += [
        "-f", "mp4",
        "pipe:1",
    ]

    if request.method == "HEAD":
        return Response(
            status_code=200,
            headers={
                "Content-Type": "video/mp4",
                "Accept-Ranges": "none",  # no seeking for remuxed streams
                "Cache-Control": "no-cache",
                "Transfer-Encoding": "chunked",
            }
        )

    # Start ffmpeg process
    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    async def generate():
        """Stream ffmpeg output in 512KB chunks."""
        try:
            while True:
                chunk = await process.stdout.read(512 * 1024)
                if not chunk:
                    break
                yield chunk
        except (Exception, asyncio.CancelledError) as e:
            print(f"Remux stream error: {e}")
        finally:
            # Drain stderr BEFORE killing to avoid race condition (bug #14)
            try:
                stderr = await asyncio.wait_for(process.stderr.read(), timeout=2)
                if stderr:
                    err_text = stderr.decode("utf-8", errors="replace")[:500]
                    if "error" in err_text.lower():
                        print(f"FFmpeg stderr: {err_text}")
            except (asyncio.TimeoutError, Exception):
                pass
            # Graceful shutdown, then force kill
            try:
                process.terminate()
                await asyncio.wait_for(process.wait(), timeout=3)
            except (asyncio.TimeoutError, ProcessLookupError):
                try:
                    process.kill()
                except ProcessLookupError:
                    pass

    return StreamingResponse(
        generate(),
        media_type="video/mp4",
        headers={
            "Content-Type": "video/mp4",
            "Accept-Ranges": "none",
            "Cache-Control": "no-cache",
            "Transfer-Encoding": "chunked",
            "X-Remux": "mkv-to-fmp4",
        }
    )


# ═══════════════════════════════════════════════════════════════════
#  ENDPOINT: Track Probe (audio & subtitle metadata)
# ═══════════════════════════════════════════════════════════════════

@app.get("/tracks/{file_id}")
async def get_tracks(file_id: str):
    """Probe a Drive file for audio and subtitle track metadata using ffprobe."""
    if not re.match(r'^[a-zA-Z0-9_-]+$', file_id):
        return JSONResponse({"error": "Invalid file ID"}, status_code=400)

    # Check cache
    now = time.time()
    if file_id in _track_cache:
        entry = _track_cache[file_id]
        if now - entry["timestamp"] < _TRACK_CACHE_TTL:
            return JSONResponse(entry["data"])

    ffprobe = _get_ffprobe_path()
    if not ffprobe:
        return JSONResponse({"error": "ffprobe not available"}, status_code=501)

    if not GDRIVE_CREDENTIALS:
        return JSONResponse({"error": "Not configured"}, status_code=500)

    try:
        download_url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media"
        _, access_token = _get_auth_session()

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
            return JSONResponse({"error": "ffprobe failed"}, status_code=500)

        probe_data = json.loads(result.stdout)
        streams = probe_data.get("streams", [])

        audio_tracks = []
        subtitle_tracks = []
        video_info = {}
        audio_idx = 0
        sub_idx = 0

        for s in streams:
            codec_type = s.get("codec_type", "")
            tags = s.get("tags", {})
            lang = tags.get("language", tags.get("LANGUAGE", ""))
            title = tags.get("title", tags.get("TITLE", ""))
            label = title or lang or ""

            if codec_type == "video" and not video_info:
                video_info = {
                    "codec": s.get("codec_name", ""),
                    "width": s.get("width", 0),
                    "height": s.get("height", 0),
                    "profile": s.get("profile", ""),
                }

            elif codec_type == "audio":
                audio_tracks.append({
                    "index": audio_idx,
                    "stream_index": s.get("index"),
                    "language": lang,
                    "label": label or f"Audio {audio_idx + 1}",
                    "codec": s.get("codec_name", ""),
                    "channels": s.get("channels", 2),
                    "channel_layout": s.get("channel_layout", ""),
                    "sample_rate": s.get("sample_rate", ""),
                    "default": s.get("disposition", {}).get("default", 0) == 1,
                })
                audio_idx += 1

            elif codec_type == "subtitle":
                subtitle_tracks.append({
                    "index": sub_idx,
                    "stream_index": s.get("index"),
                    "language": lang,
                    "lang_code": lang[:2] if lang else "un",
                    "label": label or lang or f"Subtitle {sub_idx + 1}",
                    "codec": s.get("codec_name", ""),
                    "forced": s.get("disposition", {}).get("forced", 0) == 1,
                    "default": s.get("disposition", {}).get("default", 0) == 1,
                })
                sub_idx += 1

        response_data = {
            "video": video_info,
            "audio_tracks": audio_tracks,
            "subtitle_tracks": subtitle_tracks,
            "needs_remux": _needs_remux(_get_file_meta(file_id)),
        }

        # Cache
        _track_cache[file_id] = {"data": response_data, "timestamp": now}
        while len(_track_cache) > _META_CACHE_MAX:
            _track_cache.popitem(last=False)

        return JSONResponse(response_data)

    except asyncio.TimeoutError:
        return JSONResponse({"error": "ffprobe timed out"}, status_code=504)
    except Exception as e:
        print(f"Track probe error: {e}")
        return JSONResponse({"error": str(e)[:300]}, status_code=500)


# ═══════════════════════════════════════════════════════════════════
#  ENDPOINT: Extract Embedded Subtitle
# ═══════════════════════════════════════════════════════════════════

@app.get("/subtitle/{file_id}/{track_index}")
async def get_subtitle(file_id: str, track_index: int):
    """Extract a subtitle track from a Drive file and return as WebVTT."""
    if not re.match(r'^[a-zA-Z0-9_-]+$', file_id):
        return JSONResponse({"error": "Invalid file ID"}, status_code=400)
    if track_index < 0 or track_index > 50:
        return JSONResponse({"error": "Invalid track index"}, status_code=400)

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
        download_url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media"
        _, access_token = _get_auth_session()

        cmd = [
            ffmpeg, "-v", "quiet",
            "-headers", f"Authorization: Bearer {access_token}\r\n",
            "-i", download_url,
            "-map", f"0:s:{track_index}",
            "-f", "webvtt",
            "pipe:1",
        ]
        result = await asyncio.to_thread(
            subprocess.run, cmd,
            capture_output=True, timeout=60
        )

        if result.returncode != 0:
            return JSONResponse({"error": "Extraction failed"}, status_code=500)

        vtt_data = result.stdout
        if not vtt_data or len(vtt_data) < 10:
            return JSONResponse({"error": "Empty subtitle track"}, status_code=404)

        # Cache
        while len(_subtitle_cache) >= _SUB_CACHE_MAX:
            _subtitle_cache.popitem(last=False)
        _subtitle_cache[cache_key] = vtt_data

        return Response(
            content=vtt_data,
            media_type="text/vtt",
            headers={"Cache-Control": "public, max-age=86400"}
        )

    except asyncio.TimeoutError:
        return JSONResponse({"error": "Extraction timed out"}, status_code=504)
    except Exception as e:
        return JSONResponse({"error": str(e)[:300]}, status_code=500)


# ═══════════════════════════════════════════════════════════════════
#  ENDPOINT: Search External Subtitles (subliminal-based)
# ═══════════════════════════════════════════════════════════════════

@app.get("/subtitles/search")
async def search_subtitles(
    title: str = Query(..., description="Movie or show title"),
    year: Optional[int] = Query(None),
    season: Optional[int] = Query(None),
    episode: Optional[int] = Query(None),
    lang: str = Query("en", description="Language code (en, hi, es, etc.)"),
    imdb_id: Optional[str] = Query(None, description="IMDB ID for precise matching"),
):
    """
    Search for subtitles using subliminal (aggregates multiple free providers).
    Returns WebVTT content directly — no API keys needed.

    Providers used: Podnapisi, OpenSubtitles (hash-free), Addic7ed
    """
    cache_key = f"{title}:{year}:{season}:{episode}:{lang}"
    if cache_key in _ext_subtitle_cache:
        return Response(
            content=_ext_subtitle_cache[cache_key],
            media_type="text/vtt",
            headers={"Cache-Control": "public, max-age=86400"}
        )

    try:
        vtt_content = await asyncio.to_thread(
            _search_subtitles_sync, title, year, season, episode, lang, imdb_id
        )

        if not vtt_content:
            return JSONResponse({"error": "No subtitles found", "query": title}, status_code=404)

        # Cache
        while len(_ext_subtitle_cache) >= _EXT_SUB_CACHE_MAX:
            _ext_subtitle_cache.popitem(last=False)
        _ext_subtitle_cache[cache_key] = vtt_content

        return Response(
            content=vtt_content,
            media_type="text/vtt",
            headers={"Cache-Control": "public, max-age=86400"}
        )

    except Exception as e:
        print(f"Subtitle search error: {e}")
        return JSONResponse({"error": str(e)[:300]}, status_code=500)


def _search_subtitles_sync(title, year, season, episode, lang, imdb_id):
    """Synchronous subtitle search using subliminal."""
    try:
        from subliminal import download_best_subtitles, region, scan_video
        from subliminal.video import Movie, Episode
        from babelfish import Language

        # Configure subliminal cache
        region.configure("dogpile.cache.memory")

        # Build video object
        if season is not None and episode is not None:
            video = Episode(
                name=f"{title}.S{season:02d}E{episode:02d}.mkv",
                series=title,
                season=season,
                episode=episode,
                year=year,
            )
        else:
            video = Movie(
                name=f"{title}.{year or ''}.mkv",
                title=title,
                year=year,
            )

        # Search across free providers
        if imdb_id:
            video.imdb_id = imdb_id

        target_lang = {Language(lang)}
        subtitles = download_best_subtitles(
            {video},
            target_lang,
            providers=["podnapisi", "opensubtitles"],
            provider_configs={},
        )

        best_subs = subtitles.get(video, [])
        if not best_subs:
            return None

        # Get the best subtitle content
        best = best_subs[0]
        srt_content = best.content.decode("utf-8", errors="replace")

        # Convert SRT to WebVTT
        vtt = _srt_to_vtt(srt_content)
        return vtt.encode("utf-8")

    except ImportError:
        print("⚠️ subliminal not installed, using fallback")
        return _fallback_subtitle_search(title, year, season, episode, lang)
    except Exception as e:
        print(f"Subliminal error: {e}")
        return _fallback_subtitle_search(title, year, season, episode, lang)


def _fallback_subtitle_search(title, year, season, episode, lang):
    """
    Fallback: scrape subdl.com for subtitles (no API key needed).
    subdl.com is a free subtitle aggregator.
    """
    import requests

    try:
        search_url = "https://api.subdl.com/auto"
        params = {"film_name": title, "language": lang}
        if year:
            params["year"] = year
        if season:
            params["season_number"] = season
        if episode:
            params["episode_number"] = episode

        resp = requests.get(search_url, params=params, timeout=15)
        if resp.status_code != 200:
            return None

        data = resp.json()
        if not data.get("subtitles"):
            return None

        # Download first result
        sub_url = data["subtitles"][0].get("url")
        if not sub_url:
            return None

        sub_resp = requests.get(sub_url, timeout=15)
        if sub_resp.status_code != 200:
            return None

        srt_content = sub_resp.content.decode("utf-8", errors="replace")

        # Handle both SRT and VTT formats
        if srt_content.strip().startswith("WEBVTT"):
            return srt_content.encode("utf-8")
        else:
            return _srt_to_vtt(srt_content).encode("utf-8")

    except Exception as e:
        print(f"Fallback subtitle error: {e}")
        return None


def _srt_to_vtt(srt_text: str) -> str:
    """Convert SRT subtitle format to WebVTT."""
    vtt_lines = ["WEBVTT", ""]

    # Replace SRT timestamp format (comma) with VTT format (dot)
    # SRT:  00:01:23,456 --> 00:01:25,789
    # VTT:  00:01:23.456 --> 00:01:25.789
    for line in srt_text.strip().split("\n"):
        line = line.strip("\r")
        # Replace timestamp commas with dots
        if re.match(r"\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}", line):
            line = line.replace(",", ".")
        # Skip numeric-only lines (SRT sequence numbers)
        elif re.match(r"^\d+$", line.strip()):
            continue
        vtt_lines.append(line)

    return "\n".join(vtt_lines)


# ═══════════════════════════════════════════════════════════════════
#  HLS Adaptive Streaming (Phase 2)
# ═══════════════════════════════════════════════════════════════════

HLS_CACHE_DIR = "/tmp/hls_cache"
HLS_SEGMENT_DURATION = 10  # seconds per segment
HLS_CACHE_MAX_MB = 2048    # 2GB max cache
os.makedirs(HLS_CACHE_DIR, exist_ok=True)

# Probe data cache for HLS: { file_id: { duration, video_codec, ... } }
_hls_probe_cache = OrderedDict()


def _hls_cache_path(file_id: str) -> str:
    p = os.path.join(HLS_CACHE_DIR, file_id)
    os.makedirs(p, exist_ok=True)
    return p


def _evict_hls_cache():
    """Evict oldest cached segments if total size exceeds limit."""
    try:
        total = 0
        entries = []
        for d in os.listdir(HLS_CACHE_DIR):
            dp = os.path.join(HLS_CACHE_DIR, d)
            if os.path.isdir(dp):
                for f in os.listdir(dp):
                    fp = os.path.join(dp, f)
                    s = os.path.getsize(fp)
                    total += s
                    entries.append((os.path.getmtime(fp), fp, s))
        if total > HLS_CACHE_MAX_MB * 1024 * 1024:
            entries.sort()
            for _, fp, s in entries:
                os.remove(fp)
                total -= s
                if total <= HLS_CACHE_MAX_MB * 1024 * 1024 * 0.7:
                    break
    except Exception as e:
        print(f"HLS cache eviction error: {e}")


async def _hls_probe(file_id: str):
    """Probe file for HLS metadata: duration, codecs, tracks."""
    if file_id in _hls_probe_cache:
        return _hls_probe_cache[file_id]

    ffprobe = _get_ffprobe_path()
    if not ffprobe:
        return None

    download_url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media"
    _, access_token = _get_auth_session()

    cmd = [
        ffprobe, "-v", "quiet", "-print_format", "json",
        "-show_format", "-show_streams",
        "-headers", f"Authorization: Bearer {access_token}\r\n",
        download_url
    ]
    result = await asyncio.to_thread(subprocess.run, cmd, capture_output=True, text=True, timeout=45)
    if result.returncode != 0:
        return None

    data = json.loads(result.stdout)
    fmt = data.get("format", {})
    streams = data.get("streams", [])

    duration = float(fmt.get("duration", 0))
    video = None
    audios = []
    for s in streams:
        if s.get("codec_type") == "video" and not video:
            video = {
                "codec": s.get("codec_name", ""),
                "width": int(s.get("width", 0)),
                "height": int(s.get("height", 0)),
            }
        elif s.get("codec_type") == "audio":
            tags = s.get("tags", {})
            lang = tags.get("language", tags.get("LANGUAGE", ""))
            title = tags.get("title", tags.get("TITLE", ""))
            audios.append({
                "index": len(audios),
                "language": lang,
                "label": title or lang or f"Audio {len(audios)+1}",
                "codec": s.get("codec_name", ""),
                "channels": s.get("channels", 2),
            })

    probe = {
        "duration": duration,
        "segment_count": max(1, int(duration / HLS_SEGMENT_DURATION) + 1),
        "video": video,
        "audio_tracks": audios if audios else [{"index": 0, "language": "und", "label": "Default", "codec": "aac", "channels": 2}],
        "can_copy_video": video and video["codec"] in ("h264", "hevc", "h265"),
    }
    _hls_probe_cache[file_id] = probe
    while len(_hls_probe_cache) > 50:
        _hls_probe_cache.popitem(last=False)
    return probe


@app.get("/hls/{file_id}/master.m3u8")
async def hls_master(file_id: str):
    """Generate HLS master playlist with multiple audio tracks."""
    if not re.match(r'^[a-zA-Z0-9_-]+$', file_id):
        return JSONResponse({"error": "Invalid file ID"}, status_code=400)

    probe = await _hls_probe(file_id)
    if not probe:
        return JSONResponse({"error": "Probe failed"}, status_code=500)

    v = probe["video"]
    audios = probe["audio_tracks"]

    lines = ["#EXTM3U", "#EXT-X-VERSION:6", ""]

    # Audio track entries
    for i, a in enumerate(audios):
        default = "YES" if i == 0 else "NO"
        lang = a["language"][:2] if a["language"] else "un"
        lines.append(
            f'#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="{a["label"]}",DEFAULT={default},'
            f'LANGUAGE="{lang}",URI="audio_{i}/playlist.m3u8"'
        )

    lines.append("")

    # Video quality variants (copy-codec = original quality only for now)
    w, h = v.get("width", 1920), v.get("height", 1080)
    # Estimate bandwidth based on resolution
    bw = 5000000 if h >= 1080 else 2500000 if h >= 720 else 1200000
    lines.append(f'#EXT-X-STREAM-INF:BANDWIDTH={bw},RESOLUTION={w}x{h},AUDIO="audio"')
    lines.append("video/playlist.m3u8")

    content = "\n".join(lines) + "\n"
    return Response(content=content, media_type="application/vnd.apple.mpegurl",
                    headers={"Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*"})


@app.get("/hls/{file_id}/video/playlist.m3u8")
async def hls_video_playlist(file_id: str):
    """Generate video-only HLS playlist."""
    probe = await _hls_probe(file_id)
    if not probe:
        return JSONResponse({"error": "Probe failed"}, status_code=500)

    lines = [
        "#EXTM3U",
        "#EXT-X-VERSION:6",
        f"#EXT-X-TARGETDURATION:{HLS_SEGMENT_DURATION + 2}",
        "#EXT-X-MEDIA-SEQUENCE:0",
        "#EXT-X-PLAYLIST-TYPE:VOD",
        "#EXT-X-INDEPENDENT-SEGMENTS",
    ]

    for i in range(probe["segment_count"]):
        seg_dur = min(HLS_SEGMENT_DURATION, probe["duration"] - i * HLS_SEGMENT_DURATION)
        if seg_dur <= 0:
            break
        lines.append(f"#EXTINF:{seg_dur:.3f},")
        lines.append(f"../segment/{i}.ts?type=video")

    lines.append("#EXT-X-ENDLIST")
    content = "\n".join(lines) + "\n"
    return Response(content=content, media_type="application/vnd.apple.mpegurl",
                    headers={"Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*"})


@app.get("/hls/{file_id}/audio_{track_idx}/playlist.m3u8")
async def hls_audio_playlist(file_id: str, track_idx: int):
    """Generate audio-only HLS playlist for a specific audio track."""
    probe = await _hls_probe(file_id)
    if not probe:
        return JSONResponse({"error": "Probe failed"}, status_code=500)

    lines = [
        "#EXTM3U",
        "#EXT-X-VERSION:6",
        f"#EXT-X-TARGETDURATION:{HLS_SEGMENT_DURATION + 2}",
        "#EXT-X-MEDIA-SEQUENCE:0",
        "#EXT-X-PLAYLIST-TYPE:VOD",
    ]

    for i in range(probe["segment_count"]):
        seg_dur = min(HLS_SEGMENT_DURATION, probe["duration"] - i * HLS_SEGMENT_DURATION)
        if seg_dur <= 0:
            break
        lines.append(f"#EXTINF:{seg_dur:.3f},")
        lines.append(f"../segment/{i}.ts?type=audio&track={track_idx}")

    lines.append("#EXT-X-ENDLIST")
    content = "\n".join(lines) + "\n"
    return Response(content=content, media_type="application/vnd.apple.mpegurl",
                    headers={"Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*"})


@app.get("/hls/{file_id}/segment/{seg_index}.ts")
async def hls_segment(
    file_id: str,
    seg_index: int,
    type: str = Query("video", description="video or audio"),
    track: int = Query(0, description="Audio track index"),
):
    """Generate a single HLS segment on-demand with caching."""
    if not re.match(r'^[a-zA-Z0-9_-]+$', file_id):
        return JSONResponse({"error": "Invalid file ID"}, status_code=400)

    probe = await _hls_probe(file_id)
    if not probe:
        return JSONResponse({"error": "Probe failed"}, status_code=500)

    # Check segment cache
    cache_dir = _hls_cache_path(file_id)
    cache_file = os.path.join(cache_dir, f"{type}_{track}_{seg_index}.ts")

    if os.path.exists(cache_file) and os.path.getsize(cache_file) > 0:
        with open(cache_file, "rb") as f:
            data = f.read()
        return Response(content=data, media_type="video/mp2t",
                        headers={"Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*"})

    # Generate segment via ffmpeg
    ffmpeg = _get_ffmpeg_path()
    if not ffmpeg:
        return JSONResponse({"error": "ffmpeg not available"}, status_code=501)

    download_url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media"
    _, access_token = _get_auth_session()

    start_time = seg_index * HLS_SEGMENT_DURATION
    seg_dur = min(HLS_SEGMENT_DURATION, probe["duration"] - start_time)
    if seg_dur <= 0:
        return JSONResponse({"error": "Segment out of range"}, status_code=404)

    cmd = [
        ffmpeg, "-hide_banner", "-loglevel", "error",
        "-headers", f"Authorization: Bearer {access_token}\r\n",
        "-ss", str(start_time),
        "-i", download_url
    ]

    if type == "video":
        cmd += ["-map", "0:v:0", "-an"]  # video only, no audio
        if probe.get("can_copy_video"):
            cmd += ["-c:v", "copy"]
        else:
            cmd += ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "23"]
    elif type == "audio":
        cmd += ["-map", f"0:a:{track}", "-vn", "-c:a", "aac", "-b:a", "192k", "-ac", "2"]
    else:
        return JSONResponse({"error": "Invalid type"}, status_code=400)

    cmd += ["-to", str(start_time + seg_dur), "-f", "mpegts", "-muxdelay", "0", "-muxpreload", "0", cache_file]

    result = await asyncio.to_thread(subprocess.run, cmd, capture_output=True, timeout=120)
    if result.returncode != 0:
        err = result.stderr.decode("utf-8", errors="replace")[:300]
        print(f"HLS segment error: {err}")
        # Cleanup failed file
        if os.path.exists(cache_file):
            os.remove(cache_file)
        return JSONResponse({"error": "Segment generation failed"}, status_code=500)

    if not os.path.exists(cache_file) or os.path.getsize(cache_file) == 0:
        return JSONResponse({"error": "Empty segment"}, status_code=500)

    # Evict cache if too large (async-safe, best effort)
    threading.Thread(target=_evict_hls_cache, daemon=True).start()

    with open(cache_file, "rb") as f:
        data = f.read()
    return Response(content=data, media_type="video/mp2t",
                    headers={"Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*"})


# ═══════════════════════════════════════════════════════════════════
#  Audio extraction endpoint (for subtitle space)
# ═══════════════════════════════════════════════════════════════════

@app.get("/audio/{file_id}")
async def extract_audio(file_id: str, track: int = Query(0)):
    """Extract audio track as AAC for subtitle generation services."""
    if not re.match(r'^[a-zA-Z0-9_-]+$', file_id):
        return JSONResponse({"error": "Invalid file ID"}, status_code=400)

    ffmpeg = _get_ffmpeg_path()
    if not ffmpeg:
        return JSONResponse({"error": "ffmpeg not available"}, status_code=501)

    download_url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media"
    _, access_token = _get_auth_session()

    cmd = [
        ffmpeg, "-hide_banner", "-loglevel", "error",
        "-headers", f"Authorization: Bearer {access_token}\r\n",
        "-i", download_url,
        "-map", f"0:a:{track}", "-vn",
        "-c:a", "aac", "-b:a", "64k", "-ac", "1",  # mono, low bitrate for ASR
        "-f", "adts", "pipe:1",
    ]

    process = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )

    async def generate():
        try:
            while True:
                chunk = await process.stdout.read(256 * 1024)
                if not chunk:
                    break
                yield chunk
        finally:
            try:
                process.kill()
            except ProcessLookupError:
                pass

    return StreamingResponse(generate(), media_type="audio/aac",
                             headers={"Cache-Control": "no-cache"})


# ═══════════════════════════════════════════════════════════════════
#  Root
# ═══════════════════════════════════════════════════════════════════

@app.get("/")
def root():
    return {"service": "ATMOS Media Server", "version": "2.0.0", "status": "running", "features": ["hls", "remux", "subtitles", "audio-extract"]}

