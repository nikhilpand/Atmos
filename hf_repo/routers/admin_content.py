"""Admin Content Router — TMDB search, trending, channel search, source channels, schedules"""

import os
import re
import json
import time
from fastapi import APIRouter, Request, Depends
from fastapi.responses import JSONResponse

from utils.auth import require_admin
import telegram_bot

router = APIRouter()

TMDB_API_KEY = os.environ.get("TMDB_API_KEY", "")

# ─── Source Channels ─────────────────────────────────────────────
_DEFAULT_CHANNELS = ",".join([
    "SeriesBayX0", "Netflix_Seriesbots", "MoviesFlixPro", "MoviesNestHD",
    "CinemaNestOfficial", "HDHub4uOfficial", "MoviesMoodOfficial",
    "Bollyflix_official", "GetMoviesHD", "TorrentMoviesChannel",
    "TheMoviesClub", "webseries_freezone", "EnglishTVSeries4u",
    "SeriesHouseOfficial", "TVSeriesWorld", "HindiDubedSeries",
    "AnimeKaizoku", "Anime_Library", "SubsPlease",
    "BollywoodBackup", "South_Movie_Hub", "TamilRockerz_Official",
    "TeluguFilmNagar", "MalayalamMoviesHub",
    "UHD4KMovies", "BluRayMoviesHD", "RemuxMoviesHQ",
    "filestore_bot", "MoviesHDBot",
])
SOURCE_CHANNELS = [c.strip() for c in os.environ.get("TELEGRAM_SOURCE_CHANNELS", _DEFAULT_CHANNELS).split(",") if c.strip()]

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
    try:
        with open(_CHANNELS_FILE, "w") as f:
            json.dump(SOURCE_CHANNELS, f)
    except Exception as e:
        print(f"Failed to save channel config: {e}")


# ─── Scheduler ───────────────────────────────────────────────────
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


# ─── TMDB Search ─────────────────────────────────────────────────

@router.post("/tmdb-search", dependencies=[Depends(require_admin)])
async def api_tmdb_search(request: Request):
    """Search TMDB for movies/TV shows."""
    data = await request.json()
    query = data.get("query", "").strip()
    media_type = data.get("type", "multi")
    if media_type not in ("multi", "movie", "tv"):
        media_type = "multi"
    if not query:
        return JSONResponse({"error": "Empty query"}, status_code=400)
    if not TMDB_API_KEY:
        return JSONResponse({"error": "TMDB_API_KEY not configured"}, status_code=500)
    import requests as http_req
    try:
        url = f"https://api.themoviedb.org/3/search/{media_type}"
        r = http_req.get(url, params={"api_key": TMDB_API_KEY, "query": query, "page": 1}, timeout=8)
        raw = r.json()
        results = []
        for item in (raw.get("results") or [])[:12]:
            mt = item.get("media_type", media_type)
            if mt == "person":
                continue
            title = item.get("title") or item.get("name") or ""
            rd = item.get("release_date") or item.get("first_air_date") or ""
            year = rd[:4] if rd else ""
            poster = f"https://image.tmdb.org/t/p/w342{item['poster_path']}" if item.get("poster_path") else ""
            backdrop = f"https://image.tmdb.org/t/p/w780{item['backdrop_path']}" if item.get("backdrop_path") else ""
            result = {
                "tmdb_id": item.get("id"), "title": title, "year": year,
                "media_type": mt, "poster": poster, "backdrop": backdrop,
                "rating": round(item.get("vote_average", 0), 1),
                "synopsis": item.get("overview", "")[:300],
                "popularity": item.get("popularity", 0),
            }
            if mt == "tv" and item.get("id"):
                try:
                    tv_url = f"https://api.themoviedb.org/3/tv/{item['id']}"
                    tv_r = http_req.get(tv_url, params={"api_key": TMDB_API_KEY}, timeout=5)
                    tv_data = tv_r.json()
                    seasons = []
                    for s in tv_data.get("seasons", []):
                        if s.get("season_number", 0) > 0:
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


@router.get("/tmdb/trending", dependencies=[Depends(require_admin)])
def api_admin_tmdb_trending(request: Request):
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


# ─── Channel Search ──────────────────────────────────────────────

@router.post("/channel-search", dependencies=[Depends(require_admin)])
async def api_channel_search(request: Request):
    """Search configured Telegram source channels."""
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


@router.post("/channel-search-global", dependencies=[Depends(require_admin)])
async def api_channel_search_global(request: Request):
    """Search ALL public Telegram using search_global (userbot required)."""
    data = await request.json()
    query = data.get("query", "").strip()
    if not query:
        return JSONResponse({"error": "Empty query"}, status_code=400)
    if not telegram_bot.userbot or not telegram_bot.userbot.is_initialized:
        return JSONResponse({"error": "Userbot not running"}, status_code=503)
    try:
        results = await telegram_bot.search_global_files(query, limit=data.get("limit", 50))
        # Quality-aware dedup
        results = _dedup_results(results)
        return JSONResponse({"results": results, "scope": "global", "total": len(results)})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


def _dedup_results(results):
    QUALITY_RANK = {'2160p': 5, '4k': 5, '1080p': 4, '720p': 3, '480p': 2, '360p': 1, 'unknown': 0}
    groups = {}
    for r in results:
        ep = r.get('episode_info')
        if ep:
            key = f"S{ep.get('season', 0):02d}E{ep.get('episode', 0):02d}"
        else:
            key = re.sub(r'[^a-z0-9]', '', (r.get('file_name', '') or '').lower())[:40]
        if key not in groups:
            groups[key] = []
        groups[key].append(r)
    deduped = []
    for key, group in groups.items():
        group.sort(key=lambda x: (
            QUALITY_RANK.get(x.get('quality', 'unknown'), 0), x.get('file_size', 0)
        ), reverse=True)
        deduped.extend(group)
    return deduped


# ─── Source Channel Management ───────────────────────────────────

@router.get("/source-channels", dependencies=[Depends(require_admin)])
async def api_get_source_channels(request: Request):
    return JSONResponse({"channels": SOURCE_CHANNELS})


@router.post("/source-channels", dependencies=[Depends(require_admin)])
async def api_update_source_channels(request: Request):
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


# ─── Schedules ───────────────────────────────────────────────────

@router.get("/schedules", dependencies=[Depends(require_admin)])
def api_get_schedules(request: Request):
    return JSONResponse({"schedules": _load_schedules()})


@router.post("/schedules", dependencies=[Depends(require_admin)])
async def api_save_schedule(request: Request):
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
    return JSONResponse({"success": True, "schedule": entry})


@router.post("/schedules/delete", dependencies=[Depends(require_admin)])
async def api_delete_schedule(request: Request):
    data = await request.json()
    sid = data.get("id", "")
    schedules = [s for s in _load_schedules() if s.get("id") != sid]
    _save_schedules(schedules)
    return JSONResponse({"success": True})
