"""
ATMOS Metadata Space — TMDB Enrichment & Poster Cache
Centralized metadata service to avoid rate-limiting TMDB from multiple spaces.

Endpoints:
  GET /enrich?title=...&year=...    — Search TMDB, return enriched metadata
  GET /poster/{tmdb_id}             — Proxy TMDB poster with CDN-like caching
  GET /bulk                         — Enrich multiple titles at once
  GET /health                       — Health check
"""

import os
import time
import hashlib
from collections import OrderedDict
from typing import Optional

import httpx
from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

app = FastAPI(title="ATMOS Metadata Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

TMDB_KEY = os.environ.get("TMDB_API_KEY", "")
TMDB_BASE = "https://api.themoviedb.org/3"
TMDB_IMG = "https://image.tmdb.org/t/p"

# ═══ Cache ═══
_meta_cache = OrderedDict()  # key -> {data, ts}
_META_MAX = 5000
_META_TTL = 604800  # 7 days

_poster_cache = OrderedDict()  # path -> bytes
_POSTER_MAX = 500
_POSTER_MAX_BYTES = 500 * 1024 * 1024  # 500MB


def _cache_key(title, year, media_type):
    return hashlib.md5(f"{title}:{year}:{media_type}".lower().encode()).hexdigest()


def _get_cached(key):
    if key in _meta_cache:
        entry = _meta_cache[key]
        if time.time() - entry["ts"] < _META_TTL:
            _meta_cache.move_to_end(key)
            return entry["data"]
        else:
            del _meta_cache[key]
    return None


def _set_cached(key, data):
    _meta_cache[key] = {"data": data, "ts": time.time()}
    while len(_meta_cache) > _META_MAX:
        _meta_cache.popitem(last=False)


# ═══ TMDB Search ═══
async def _search_tmdb(title, year=None, media_type="movie"):
    if not TMDB_KEY:
        return None

    endpoint = "search/movie" if media_type == "movie" else "search/tv"
    params = {"api_key": TMDB_KEY, "query": title, "include_adult": "false"}
    if year:
        params["year" if media_type == "movie" else "first_air_date_year"] = year

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{TMDB_BASE}/{endpoint}", params=params)
            if resp.status_code != 200:
                return None
            data = resp.json()
            results = data.get("results", [])
            if not results:
                # Try the other type
                alt_type = "tv" if media_type == "movie" else "movie"
                alt_endpoint = f"search/{alt_type}"
                alt_params = {"api_key": TMDB_KEY, "query": title}
                resp2 = await client.get(f"{TMDB_BASE}/{alt_endpoint}", params=alt_params)
                if resp2.status_code == 200:
                    results = resp2.json().get("results", [])
                    media_type = alt_type

            if not results:
                return None

            best = results[0]
            tmdb_id = best["id"]

            # Get detailed info
            detail_resp = await client.get(
                f"{TMDB_BASE}/{media_type}/{tmdb_id}",
                params={"api_key": TMDB_KEY, "append_to_response": "credits,external_ids"}
            )
            detail = detail_resp.json() if detail_resp.status_code == 200 else best

            title_key = "title" if media_type == "movie" else "name"
            date_key = "release_date" if media_type == "movie" else "first_air_date"

            poster = detail.get("poster_path")
            backdrop = detail.get("backdrop_path")
            credits = detail.get("credits", {})
            cast = credits.get("cast", [])[:10]

            return {
                "tmdb_id": tmdb_id,
                "media_type": media_type,
                "title": detail.get(title_key, title),
                "original_title": detail.get(f"original_{title_key}", ""),
                "year": (detail.get(date_key, "") or "")[:4],
                "overview": detail.get("overview", ""),
                "rating": detail.get("vote_average", 0),
                "vote_count": detail.get("vote_count", 0),
                "genres": [g["name"] for g in detail.get("genres", [])],
                "runtime": detail.get("runtime") or detail.get("episode_run_time", [None])[0] if detail.get("episode_run_time") else None,
                "poster_url": f"{TMDB_IMG}/w500{poster}" if poster else None,
                "backdrop_url": f"{TMDB_IMG}/w1280{backdrop}" if backdrop else None,
                "poster_path": poster,
                "backdrop_path": backdrop,
                "cast": [{"name": c["name"], "character": c.get("character", ""), "profile": f"{TMDB_IMG}/w185{c['profile_path']}" if c.get("profile_path") else None} for c in cast],
                "imdb_id": detail.get("external_ids", {}).get("imdb_id") or detail.get("imdb_id"),
                "status": detail.get("status"),
                "tagline": detail.get("tagline", ""),
            }
    except Exception as e:
        print(f"TMDB search error: {e}")
        return None


# ═══ ENDPOINTS ═══

@app.get("/trending")
async def trending(page: int = Query(1), media_type: str = Query("all"), time_window: str = Query("day")):
    """Fetch trending content for the home page catalog."""
    if not TMDB_KEY:
        return JSONResponse({"error": "TMDB_API_KEY not configured"}, status_code=500)
    
    # media_type can be 'all', 'movie', 'tv', 'person'
    # time_window can be 'day', 'week'
    url = f"{TMDB_BASE}/trending/{media_type}/{time_window}"
    
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, params={"api_key": TMDB_KEY, "page": page})
            if resp.status_code == 200:
                data = resp.json()
                # Clean up results
                results = []
                for item in data.get("results", []):
                    # Standardize keys
                    title = item.get("title") or item.get("name")
                    date = item.get("release_date") or item.get("first_air_date") or ""
                    results.append({
                        "tmdb_id": item.get("id"),
                        "media_type": item.get("media_type", media_type if media_type != "all" else "movie"),
                        "title": title,
                        "year": date[:4] if date else "",
                        "overview": item.get("overview", ""),
                        "rating": item.get("vote_average", 0),
                        "poster_path": item.get("poster_path"),
                        "backdrop_path": item.get("backdrop_path"),
                        "poster_url": f"{TMDB_IMG}/w500{item.get('poster_path')}" if item.get("poster_path") else None
                    })
                return {"page": data.get("page"), "total_pages": data.get("total_pages"), "results": results}
            return JSONResponse({"error": "TMDB API Error"}, status_code=resp.status_code)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

@app.get("/search")
async def search_multi(query: str = Query(...), page: int = Query(1)):
    """Search for movies and TV shows simultaneously."""
    if not TMDB_KEY:
        return JSONResponse({"error": "TMDB_API_KEY not configured"}, status_code=500)
    
    url = f"{TMDB_BASE}/search/multi"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, params={"api_key": TMDB_KEY, "query": query, "page": page, "include_adult": "false"})
            if resp.status_code == 200:
                data = resp.json()
                results = []
                for item in data.get("results", []):
                    mtype = item.get("media_type")
                    if mtype not in ["movie", "tv"]:
                        continue # Skip persons
                    
                    title = item.get("title") or item.get("name")
                    date = item.get("release_date") or item.get("first_air_date") or ""
                    results.append({
                        "tmdb_id": item.get("id"),
                        "media_type": mtype,
                        "title": title,
                        "year": date[:4] if date else "",
                        "overview": item.get("overview", ""),
                        "rating": item.get("vote_average", 0),
                        "poster_path": item.get("poster_path"),
                        "backdrop_path": item.get("backdrop_path"),
                        "poster_url": f"{TMDB_IMG}/w500{item.get('poster_path')}" if item.get("poster_path") else None
                    })
                return {"page": data.get("page"), "total_pages": data.get("total_pages"), "results": results}
            return JSONResponse({"error": "TMDB API Error"}, status_code=resp.status_code)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

@app.get("/health")
def health():
    return {
        "status": "ok",
        "tmdb_configured": bool(TMDB_KEY),
        "cache_entries": len(_meta_cache),
        "poster_cache": len(_poster_cache),
        "version": "1.0.0",
    }


@app.get("/enrich")
async def enrich(
    title: str = Query(...),
    year: Optional[int] = Query(None),
    media_type: str = Query("movie"),
):
    """Search TMDB and return enriched metadata with caching."""
    key = _cache_key(title, year, media_type)

    cached = _get_cached(key)
    if cached:
        return JSONResponse(cached, headers={"X-Cache": "hit"})

    result = await _search_tmdb(title, year, media_type)
    if result:
        _set_cached(key, result)
        return JSONResponse(result, headers={"X-Cache": "miss"})

    return JSONResponse({"error": "Not found", "query": title}, status_code=404)


@app.get("/poster/{path:path}")
async def proxy_poster(path: str, size: str = Query("w500")):
    """Proxy TMDB poster/backdrop images with caching headers."""
    cache_key = f"{size}/{path}"

    if cache_key in _poster_cache:
        _poster_cache.move_to_end(cache_key)
        return Response(
            content=_poster_cache[cache_key],
            media_type="image/jpeg",
            headers={"Cache-Control": "public, max-age=2592000", "X-Cache": "hit"},
        )

    url = f"{TMDB_IMG}/{size}/{path}"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                return JSONResponse({"error": "Image not found"}, status_code=404)

            img_data = resp.content
            content_type = resp.headers.get("content-type", "image/jpeg")

            # Cache in memory
            _poster_cache[cache_key] = img_data
            while len(_poster_cache) > _POSTER_MAX:
                _poster_cache.popitem(last=False)

            return Response(
                content=img_data,
                media_type=content_type,
                headers={"Cache-Control": "public, max-age=2592000", "X-Cache": "miss"},
            )
    except Exception as e:
        return JSONResponse({"error": str(e)[:200]}, status_code=500)


@app.post("/bulk")
async def bulk_enrich(request: Request):
    """Enrich multiple titles at once."""
    try:
        body = await request.json()
        titles = body.get("titles", [])
    except Exception:
        return JSONResponse({"error": "Invalid request"}, status_code=400)

    results = []
    for item in titles[:50]:  # Limit to 50 per request
        title = item.get("title", "")
        year = item.get("year")
        mtype = item.get("media_type", "movie")
        if not title:
            continue

        key = _cache_key(title, year, mtype)
        cached = _get_cached(key)
        if cached:
            results.append(cached)
            continue

        result = await _search_tmdb(title, year, mtype)
        if result:
            _set_cached(key, result)
            results.append(result)

    return JSONResponse({"results": results, "total": len(results)})


@app.get("/")
def root():
    return {"service": "ATMOS Metadata Service", "version": "1.0.0", "features": ["enrich", "poster-proxy", "bulk"]}
