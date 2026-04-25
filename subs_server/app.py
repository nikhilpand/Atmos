"""
ATMOS Provider Health Engine + Subtitle Service
Runs on atmos-subs HF Space — dual purpose:

1. PROVIDER HEALTH: Background loop tests all streaming providers,
   caches health scores, pre-warms trending titles, stores user-reported results
2. SUBTITLES: Original subtitle search/generation (kept intact)

Endpoints:
  GET  /provider-health          — Get live provider health scores
  POST /provider-report          — Frontend reports which provider worked/failed
  GET  /provider-prewarmed       — Get pre-warmed links for a TMDB title
  GET  /search?title=...         — Search subtitles (original)
  GET  /health                   — Health check
"""

import os
import re
import json
import time
import hashlib
import asyncio
import threading
from collections import OrderedDict
from typing import Optional, Dict, List

import httpx
from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

app = FastAPI(title="ATMOS Provider Health + Subs", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ═══════════════════════════════════════════════════════════════════════
# PROVIDER HEALTH ENGINE
# ═══════════════════════════════════════════════════════════════════════

PROVIDERS = [
    # Tier 1: Fastest (<1s), verified 2026-04-25
    {"id": "videasy", "name": "Videasy", "pattern": "https://player.videasy.net/{type}/{tmdb_id}", "style": "path"},
    {"id": "vidsrc_icu", "name": "VidSrc ICU", "pattern": "https://vidsrc.icu/embed/{type}/{tmdb_id}", "style": "path"},
    {"id": "vidlink", "name": "VidLink", "pattern": "https://atmos-proxy.nkp9450732628.workers.dev/{type}/{tmdb_id}", "style": "path"},
    {"id": "2embed", "name": "2Embed", "pattern": "https://www.2embed.cc/embed/{tmdb_id}", "style": "custom"},
    # Tier 2: Fast (<2s), reliable
    {"id": "vidsrc_dev", "name": "VidSrc Dev", "pattern": "https://vidsrc.dev/embed/{type}/{tmdb_id}", "style": "path"},
    {"id": "nontongo", "name": "NonTongo", "pattern": "https://nontongo.win/embed/{type}/{tmdb_id}", "style": "path"},
    {"id": "vidfast", "name": "VidFast", "pattern": "https://vidfast.pro/{type}/{tmdb_id}", "style": "path"},
    {"id": "vidjoy", "name": "VidJoy", "pattern": "https://vidjoy.pro/embed/{type}/{tmdb_id}", "style": "path"},
    {"id": "vidsrc_wtf", "name": "VidSrc WTF", "pattern": "https://vidsrc.wtf/api/3/{type}/?id={tmdb_id}", "style": "query"},
    # Tier 3: Slower fallbacks
    {"id": "111movies", "name": "111Movies", "pattern": "https://111movies.com/{type}/{tmdb_id}", "style": "path"},
    {"id": "autoembed", "name": "AutoEmbed", "pattern": "https://autoembed.co/{type}/tmdb/{tmdb_id}", "style": "dash"},
    {"id": "moviesapi", "name": "MoviesAPI", "pattern": "https://moviesapi.club/{type}/{tmdb_id}", "style": "dash"},
]

TMDB_API_KEY = os.environ.get("TMDB_API_KEY", "")
META_URL = os.environ.get("META_URL", "https://nikhil1776-atmos-meta.hf.space")
HEALTH_FILE = "/tmp/provider_health.json"
PREWARM_FILE = "/tmp/prewarm_cache.json"

# In-memory stores
_provider_health: Dict[str, dict] = {}  # provider_id -> {score, last_check, latency, consecutive_fails}
_prewarm_cache: Dict[str, dict] = {}    # "tmdb_id:type" -> {provider_id: {status, latency, checked_at}}
_user_reports: Dict[str, dict] = {}     # "tmdb_id:type:s:e" -> {provider_id: {ok: int, fail: int}}
_health_lock = asyncio.Lock()        # For async background tasks
_sync_lock   = threading.Lock()      # For sync FastAPI endpoints
_prewarm_semaphore = asyncio.Semaphore(15)  # Max 15 concurrent health checks


def _load_health():
    global _provider_health, _prewarm_cache
    try:
        if os.path.exists(HEALTH_FILE):
            with open(HEALTH_FILE) as f:
                _provider_health = json.load(f)
    except Exception:
        pass
    try:
        if os.path.exists(PREWARM_FILE):
            with open(PREWARM_FILE) as f:
                _prewarm_cache = json.load(f)
    except Exception:
        pass


def _save_health():
    try:
        with open(HEALTH_FILE, "w") as f:
            json.dump(_provider_health, f)
    except Exception:
        pass
    try:
        with open(PREWARM_FILE, "w") as f:
            json.dump(_prewarm_cache, f)
    except Exception:
        pass


def _build_url(provider, tmdb_id, media_type, season=None, episode=None):
    url = provider["pattern"].replace("{tmdb_id}", str(tmdb_id)).replace("{type}", media_type)
    if media_type != "tv" or not season or not episode:
        return url
    style = provider["style"]
    if style == "path":
        return f"{url}/{season}/{episode}"
    elif style == "dash":
        return f"{url}-{season}-{episode}"
    elif style == "query":
        sep = "&" if "?" in url else "?"
        if "multiembed" in url:
            return f"{url}&s={season}&e={episode}"
        return f"{url}{sep}season={season}&episode={episode}"
    elif style == "custom":
        if provider["id"] == "2embed" and media_type == "tv":
            return f"https://www.2embed.cc/embedtv/{tmdb_id}&s={season}&e={episode}"
        return f"{url}/{season}/{episode}"
    return url


async def _check_provider_alive(provider_id, url):
    """HEAD-only check with tight timeout. No GET fallback (too slow)."""
    try:
        async with _prewarm_semaphore:
            async with httpx.AsyncClient(timeout=3.0, follow_redirects=True) as client:
                start = time.time()
                resp = await client.head(url)
                latency = round((time.time() - start) * 1000)
                alive = resp.status_code < 400
                return {"alive": alive, "latency": latency, "status": resp.status_code}
    except Exception:
        return {"alive": False, "latency": 9999, "status": 0}


async def _run_global_health_check():
    """Test all providers with a known popular movie (Inception TMDB 27205)."""
    test_tmdb = "27205"
    test_type = "movie"
    print(f"[Health] Running global provider health check...")

    tasks = []
    for p in PROVIDERS:
        url = _build_url(p, test_tmdb, test_type)
        tasks.append((p["id"], _check_provider_alive(p["id"], url)))

    results = await asyncio.gather(*[t[1] for t in tasks], return_exceptions=True)

    async with _health_lock:
        for i, (pid, _) in enumerate(tasks):
            res = results[i] if not isinstance(results[i], Exception) else {"alive": False, "latency": 9999}
            prev = _provider_health.get(pid, {"score": 50, "consecutive_fails": 0})
            if res.get("alive"):
                new_score = min(100, prev["score"] + 10)
                _provider_health[pid] = {
                    "score": new_score,
                    "latency": res["latency"],
                    "last_check": time.time(),
                    "consecutive_fails": 0,
                    "alive": True,
                }
            else:
                fails = prev.get("consecutive_fails", 0) + 1
                new_score = max(0, prev["score"] - 20)
                _provider_health[pid] = {
                    "score": new_score,
                    "latency": 9999,
                    "last_check": time.time(),
                    "consecutive_fails": fails,
                    "alive": False,
                }
        _save_health()

    alive = sum(1 for v in _provider_health.values() if v.get("alive"))
    print(f"[Health] Done: {alive}/{len(PROVIDERS)} providers alive")


async def _run_prewarm():
    """Pre-warm top trending titles — check which providers actually work for them."""
    print("[PreWarm] Fetching trending titles...")
    trending_ids = []
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{META_URL}/trending?page=1&media_type=all&time_window=week")
            if resp.status_code == 200:
                data = resp.json()
                for item in (data.get("results") or [])[:30]:
                    tmdb_id = item.get("tmdb_id") or item.get("id")
                    mtype = item.get("media_type", "movie")
                    if tmdb_id:
                        trending_ids.append((str(tmdb_id), mtype))
    except Exception as e:
        print(f"[PreWarm] Failed to fetch trending: {e}")
        return

    print(f"[PreWarm] Testing {len(trending_ids)} titles x {len(PROVIDERS)} providers...")

    for tmdb_id, mtype in trending_ids:
        cache_key = f"{tmdb_id}:{mtype}"
        title_results = {}
        tasks = []
        for p in PROVIDERS:
            # Skip globally dead providers
            health = _provider_health.get(p["id"], {})
            if health.get("consecutive_fails", 0) >= 5:
                continue
            url = _build_url(p, tmdb_id, mtype, season=1, episode=1)
            tasks.append((p["id"], url, _check_provider_alive(p["id"], url)))

        results = await asyncio.gather(*[t[2] for t in tasks], return_exceptions=True)
        for i, (pid, url, _) in enumerate(tasks):
            res = results[i] if not isinstance(results[i], Exception) else {"alive": False}
            title_results[pid] = {
                "alive": res.get("alive", False),
                "latency": res.get("latency", 9999),
                "url": url,
                "checked_at": time.time(),
            }

    async with _health_lock:
        _prewarm_cache[cache_key] = title_results

    # Batch write every 5 titles
    if len(_prewarm_cache) % 5 == 0:
        _save_health()

    print(f"[PreWarm] Cached {len(_prewarm_cache)} titles")


def _background_loop():
    """Runs forever in a background thread."""
    async def _loop():
        _load_health()
        while True:
            try:
                await _run_global_health_check()
            except Exception as e:
                print(f"[Health] Error: {e}")
            try:
                await _run_prewarm()
            except Exception as e:
                print(f"[PreWarm] Error: {e}")
            await asyncio.sleep(300)  # Every 5 minutes

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(_loop())


# Start background health checker on startup
@app.on_event("startup")
def start_health_checker():
    _load_health()
    t = threading.Thread(target=_background_loop, daemon=True)
    t.start()
    print("[ATMOS] Provider Health Engine started")


# ═══ PROVIDER HEALTH API ═══

@app.get("/provider-health")
def get_provider_health():
    """Returns live health scores for all providers."""
    with _sync_lock:
        return {
            "providers": _provider_health,
            "total": len(PROVIDERS),
            "alive": sum(1 for v in _provider_health.values() if v.get("alive")),
            "cached_titles": len(_prewarm_cache),
            "updated_at": max((v.get("last_check", 0) for v in _provider_health.values()), default=0),
        }


def _compute_smart_score(global_score: float, prewarmed: bool, prewarm_alive: bool,
                          latency_ms: float, user_ok: int, user_fail: int, alive: bool) -> float:
    """
    ATMOS Smart Score Algorithm (0-100):
      40% — Global health score (background ping results)
      25% — Title-specific prewarm (did this server work for THIS title?)
      20% — User-reported success rate (crowdsourced reliability)
      15% — Latency score (lower = better, 0ms = 100pts, 3000ms = 0pts)
    Dead providers (alive=False) always score 0.
    """
    if not alive:
        return 0.0
    latency_score = max(0.0, 100.0 - (latency_ms / 30.0))
    prewarm_score = (100.0 if prewarm_alive else 0.0) if prewarmed else 50.0
    total_reports = user_ok + user_fail
    user_score = (user_ok / total_reports * 100.0) if total_reports > 0 else 50.0
    return round(min(100.0, max(0.0,
        global_score  * 0.40 +
        prewarm_score * 0.25 +
        user_score    * 0.20 +
        latency_score * 0.15
    )), 1)


@app.get("/recommend")
def recommend_provider(
    tmdb_id: str = Query(...),
    type: str = Query("movie"),
    season: int = Query(0),
    episode: int = Query(0),
):
    """
    Returns the single best provider + ordered fallback list using the SMART SCORE algorithm.
    Used by the frontend auto-select feature.
    """
    cache_key = f"{tmdb_id}:{type}"
    report_key = f"{tmdb_id}:{type}:{season}:{episode}"

    with _sync_lock:
        prewarm = _prewarm_cache.get(cache_key, {})
        user_reports = _user_reports.get(report_key, {})

    ranked = []
    for p in PROVIDERS:
        pid = p["id"]
        health = _provider_health.get(pid, {"score": 50, "alive": True, "latency": 3000})
        pw_info = prewarm.get(pid, {})
        ur = user_reports.get(pid, {"ok": 0, "fail": 0})

        smart = _compute_smart_score(
            global_score=health.get("score", 50),
            prewarmed=bool(pw_info),
            prewarm_alive=pw_info.get("alive", False),
            latency_ms=health.get("latency", 3000),
            user_ok=ur.get("ok", 0),
            user_fail=ur.get("fail", 0),
            alive=health.get("alive", True),
        )
        url = _build_url(p, tmdb_id, type, season or None, episode or None)
        ranked.append({
            "id": pid,
            "name": p.get("name", pid),
            "url": url,
            "smart_score": smart,
            "alive": health.get("alive", True),
            "latency": health.get("latency", 3000),
            "global_score": health.get("score", 50),
            "prewarm_alive": pw_info.get("alive") if pw_info else None,
            "user_ok": ur.get("ok", 0),
            "user_fail": ur.get("fail", 0),
        })

    ranked.sort(key=lambda x: (-x["smart_score"], x["latency"]))
    live = [r for r in ranked if r["smart_score"] > 0]
    final = live if live else ranked  # Never return empty

    return {
        "best": final[0] if final else None,
        "fallbacks": final[1:],
        "algorithm": "smart-v4",
        "from_prewarm": bool(prewarm),
        "total_providers": len(ranked),
    }


@app.get("/provider-prewarmed")
def get_prewarmed(
    tmdb_id: str = Query(...),
    type: str = Query("movie"),
):
    """Returns pre-warmed provider results for a specific title."""
    cache_key = f"{tmdb_id}:{type}"
    with _sync_lock:
        cached = _prewarm_cache.get(cache_key)
        user_data = {}
        # Merge user reports for this title
        for key, reports in _user_reports.items():
            if key.startswith(f"{tmdb_id}:{type}:"):
                for pid, counts in reports.items():
                    if pid not in user_data:
                        user_data[pid] = {"ok": 0, "fail": 0}
                    user_data[pid]["ok"] += counts.get("ok", 0)
                    user_data[pid]["fail"] += counts.get("fail", 0)

    if cached:
        # Merge health scores
        ranked = []
        for pid, info in cached.items():
            health = _provider_health.get(pid, {})
            ur = user_data.get(pid, {"ok": 0, "fail": 0})
            total_reports = ur["ok"] + ur["fail"]
            user_score = (ur["ok"] / total_reports * 100) if total_reports > 0 else 50
            combined_score = (health.get("score", 50) * 0.4 + (100 if info["alive"] else 0) * 0.4 + user_score * 0.2)
            ranked.append({
                "id": pid,
                "alive": info["alive"],
                "latency": info["latency"],
                "url": info["url"],
                "health_score": round(combined_score),
                "user_reports": ur,
            })
        ranked.sort(key=lambda x: (-x["health_score"], x["latency"]))
        return {"providers": ranked, "from_cache": True}

    # Not pre-warmed — return global health for sorting
    ranked = []
    for p in PROVIDERS:
        health = _provider_health.get(p["id"], {"score": 50, "alive": True})
        ranked.append({
            "id": p["id"],
            "alive": health.get("alive", True),
            "latency": health.get("latency", 5000),
            "health_score": health.get("score", 50),
        })
    ranked.sort(key=lambda x: (-x["health_score"], x["latency"]))
    return {"providers": ranked, "from_cache": False}


@app.post("/provider-report")
async def report_provider(request: Request):
    """Frontend reports which provider worked or failed for a title."""
    try:
        body = await request.json()
        tmdb_id = str(body.get("tmdb_id", ""))
        media_type = body.get("type", "movie")
        season = body.get("season", 0)
        episode = body.get("episode", 0)
        provider_id = body.get("provider_id", "")
        success = body.get("success", False)
    except Exception:
        return JSONResponse({"error": "Invalid body"}, status_code=400)

    if not tmdb_id or not provider_id:
        return JSONResponse({"error": "Missing fields"}, status_code=400)

    key = f"{tmdb_id}:{media_type}:{season}:{episode}"
    with _sync_lock:
        if key not in _user_reports:
            _user_reports[key] = {}
        if provider_id not in _user_reports[key]:
            _user_reports[key][provider_id] = {"ok": 0, "fail": 0}
        if success:
            _user_reports[key][provider_id]["ok"] += 1
        else:
            _user_reports[key][provider_id]["fail"] += 1

        # Evict old reports (keep 2000 titles max)
        if len(_user_reports) > 2000:
            keys = list(_user_reports.keys())
            for k in keys[:len(keys) - 1500]:
                del _user_reports[k]

    return {"status": "recorded"}


# ═══════════════════════════════════════════════════════════════════════
# TELEMETRY ENGINE — Self-learning provider affinity from real data
# ═══════════════════════════════════════════════════════════════════════

_telemetry_store: Dict[str, List[dict]] = {}  # "provider:category" -> [{success, latency, ts}]
TELEMETRY_FILE = "/tmp/telemetry.json"

def _load_telemetry():
    global _telemetry_store
    try:
        if os.path.exists(TELEMETRY_FILE):
            with open(TELEMETRY_FILE) as f:
                _telemetry_store = json.load(f)
    except Exception:
        pass

def _save_telemetry():
    try:
        with open(TELEMETRY_FILE, "w") as f:
            json.dump(_telemetry_store, f)
    except Exception:
        pass


@app.post("/telemetry/batch")
async def batch_telemetry(request: Request):
    """
    Receives a batch of provider performance events from the frontend.
    Each event: {providerId, tmdbId, category, success, latencyMs, timestamp}
    """
    try:
        body = await request.json()
        events = body.get("events", [])
    except Exception:
        return JSONResponse({"error": "Invalid body"}, status_code=400)

    if not events or not isinstance(events, list):
        return JSONResponse({"error": "No events"}, status_code=400)

    recorded = 0
    with _sync_lock:
        for event in events[:100]:  # Max 100 per batch
            pid = event.get("providerId", "")
            category = event.get("category", "general")
            success = event.get("success", False)
            latency = event.get("latencyMs", 9999)
            ts = event.get("timestamp", time.time() * 1000)

            if not pid:
                continue

            key = f"{pid}:{category}"
            if key not in _telemetry_store:
                _telemetry_store[key] = []

            _telemetry_store[key].append({
                "s": 1 if success else 0,
                "l": min(latency, 30000),
                "t": ts,
            })

            # Keep last 200 events per key
            if len(_telemetry_store[key]) > 200:
                _telemetry_store[key] = _telemetry_store[key][-150:]

            recorded += 1

        # Also feed into user_reports for backward compatibility
        for event in events[:100]:
            pid = event.get("providerId", "")
            tmdb_id = event.get("tmdbId", "")
            success = event.get("success", False)
            if pid and tmdb_id:
                rkey = f"{tmdb_id}:movie:0:0"
                if rkey not in _user_reports:
                    _user_reports[rkey] = {}
                if pid not in _user_reports[rkey]:
                    _user_reports[rkey][pid] = {"ok": 0, "fail": 0}
                if success:
                    _user_reports[rkey][pid]["ok"] += 1
                else:
                    _user_reports[rkey][pid]["fail"] += 1

        _save_telemetry()

    return {"status": "ok", "recorded": recorded}


@app.get("/provider-affinity")
def get_provider_affinity():
    """
    Returns dynamic affinity scores computed from real telemetry.
    Response: { "anime": {"videasy": 18, "vidsrc_icu": 12, ...}, "netflix": {...}, ... }
    
    The frontend resolve engine uses these to replace the static affinity matrix.
    """
    # Compute affinity from telemetry
    affinity: Dict[str, Dict[str, float]] = {}
    cutoff = (time.time() - 7 * 86400) * 1000  # Last 7 days in ms

    with _sync_lock:
        for key, events in _telemetry_store.items():
            parts = key.split(":", 1)
            if len(parts) != 2:
                continue
            pid, category = parts

            # Filter recent events
            recent = [e for e in events if e.get("t", 0) > cutoff]
            if len(recent) < 5:
                continue  # Need minimum data points

            total = len(recent)
            successes = sum(1 for e in recent if e.get("s"))
            success_rate = successes / total
            avg_latency = sum(e.get("l", 3000) for e in recent if e.get("s")) / max(1, successes)

            # Dynamic affinity: high success + low latency = high boost
            # Scale: -15 to +25 (matches static matrix range)
            affinity_score = round(
                (success_rate * 25)  # Max +25 for 100% success
                - (avg_latency / 500)  # Penalty for slow providers
            )
            affinity_score = max(-15, min(25, affinity_score))

            if category not in affinity:
                affinity[category] = {}
            affinity[category][pid] = affinity_score

    return {
        "affinity": affinity,
        "data_points": sum(len(v) for v in _telemetry_store.values()),
        "categories": len(affinity),
        "algorithm": "telemetry-v1",
    }


# Load telemetry on startup
_original_start = start_health_checker
def _enhanced_start():
    _load_telemetry()
    _original_start()
    print("[ATMOS] Telemetry Engine loaded")

# Monkey-patch startup
app.on_event("startup")(_enhanced_start)

# ═══════════════════════════════════════════════════════════════════════
# SUBTITLE SERVICE (original, kept intact)
# ═══════════════════════════════════════════════════════════════════════

WYZIE_API = "https://api.wyzie.ru/subs/search"
VTT_CACHE_DIR = "/tmp/vtt_cache"
os.makedirs(VTT_CACHE_DIR, exist_ok=True)
_mem_cache = OrderedDict()
_MEM_CACHE_MAX = 200


def _cache_key(title, year, season, episode, lang):
    raw = f"{title}:{year}:{season}:{episode}:{lang}".lower()
    return hashlib.md5(raw.encode()).hexdigest()


def _disk_cache_get(key):
    path = os.path.join(VTT_CACHE_DIR, f"{key}.vtt")
    if os.path.exists(path):
        age = (time.time() - os.path.getmtime(path)) / 86400
        if age < 30:
            with open(path, "rb") as f:
                return f.read()
        else:
            os.remove(path)
    return None


def _disk_cache_set(key, data):
    with open(os.path.join(VTT_CACHE_DIR, f"{key}.vtt"), "wb") as f:
        f.write(data)


def _srt_to_vtt(srt_text):
    lines = ["WEBVTT", ""]
    for line in srt_text.strip().split("\n"):
        line = line.strip("\r")
        if re.match(r"\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}", line):
            line = line.replace(",", ".")
        elif re.match(r"^\d+$", line.strip()):
            continue
        lines.append(line)
    return "\n".join(lines)


async def _search_wyzie(title, year=None, season=None, episode=None, lang="en"):
    try:
        params = {"q": title, "lang": lang}
        if year: params["year"] = year
        if season is not None: params["season"] = season
        if episode is not None: params["episode"] = episode
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(WYZIE_API, params=params)
            if resp.status_code != 200: return None
            data = resp.json()
            if not data or not isinstance(data, list): return None
            best = data[0]
            sub_url = best.get("url") or best.get("download_url")
            if not sub_url: return None
            sub_resp = await client.get(sub_url)
            if sub_resp.status_code != 200: return None
            content = sub_resp.text
            if content.strip().startswith("WEBVTT"):
                return content.encode("utf-8")
            return _srt_to_vtt(content).encode("utf-8")
    except Exception:
        return None


@app.get("/search")
async def search_subtitles(
    title: str = Query(...),
    year: Optional[int] = Query(None),
    season: Optional[int] = Query(None),
    episode: Optional[int] = Query(None),
    lang: str = Query("en"),
):
    key = _cache_key(title, year, season, episode, lang)
    cached = _disk_cache_get(key)
    if cached:
        return Response(content=cached, media_type="text/vtt", headers={"X-Source": "cache"})
    result = await _search_wyzie(title, year, season, episode, lang)
    if result:
        _disk_cache_set(key, result)
        return Response(content=result, media_type="text/vtt", headers={"X-Source": "wyzie"})
    return JSONResponse({"error": "No subtitles found"}, status_code=404)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "version": "3.0.0",
        "services": ["provider-health", "telemetry-engine", "subtitles"],
        "providers_tracked": len(_provider_health),
        "titles_prewarmed": len(_prewarm_cache),
        "user_reports": len(_user_reports),
        "telemetry_keys": len(_telemetry_store),
        "telemetry_events": sum(len(v) for v in _telemetry_store.values()),
    }


@app.get("/")
def root():
    return {
        "service": "ATMOS Provider Health Engine + Telemetry + Subs",
        "version": "3.0.0",
        "endpoints": [
            "/provider-health", "/provider-prewarmed", "/provider-report",
            "/recommend", "/telemetry/batch", "/provider-affinity",
            "/search", "/health",
        ],
    }

