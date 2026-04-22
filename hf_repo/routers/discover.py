"""Discover Router — /api/discover/search, forward, auto-forward, /api/torrent-search"""

import os
import re
import asyncio
from typing import Optional
from fastapi import APIRouter, Request, Depends
from fastapi.responses import JSONResponse

from utils.auth import require_admin
import telegram_bot
import smart_search
import torrent_search

router = APIRouter()

TMDB_API_KEY = os.environ.get("TMDB_API_KEY", "")

# Import SOURCE_CHANNELS from content router (single source of truth)
def _get_source_channels():
    try:
        from routers.admin_content import SOURCE_CHANNELS
        return SOURCE_CHANNELS
    except ImportError:
        return []


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


async def _return_results(results):
    """Helper to return pre-fetched results as an async callable."""
    return results


@router.post("/discover/search", dependencies=[Depends(require_admin)])
async def api_discover_search(request: Request):
    """V2: Multi-source smart search — Telegram + external providers."""
    data = await request.json()
    query = data.get("query", "").strip()
    if not query:
        return JSONResponse({"error": "Empty query"}, status_code=400)

    SOURCE_CHANNELS = _get_source_channels()
    preferences = {
        "quality": data.get("quality", "1080p"),
        "language": data.get("language", ""),
        "seasons": data.get("seasons", []),
        "auto_select": False,
    }
    enabled_sources = data.get("enabled_sources", None)
    media_type_hint = data.get("media_type", "all")

    async def search_fn(q):
        results = []
        tasks = []
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
                for r in tg_results:
                    r["source_provider"] = "Telegram"
                return tg_results
            tasks.append(("telegram", _telegram_search()))

        try:
            import multi_source
            external_sources = enabled_sources
            if external_sources and "telegram" in external_sources:
                external_sources = [s for s in external_sources if s != "telegram"]
            elif external_sources is None:
                external_sources = None

            async def _external_search():
                result = await multi_source.search_all_providers(
                    query=q, media_type=media_type_hint,
                    enabled_providers=external_sources,
                    limit_per_provider=30, timeout=8.0,
                )
                return result.get("results", []), result.get("provider_counts", {}), result.get("errors", {})
            tasks.append(("external", _external_search()))
        except ImportError:
            print("⚠️ multi_source module not available")

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

    try:
        raw_results, prov_counts, prov_errors = await search_fn(query)
        result = await smart_search.smart_search(
            query=query, preferences=preferences,
            search_fn=lambda q: _return_results(raw_results),
            tmdb_fn=lambda q: _tmdb_lookup_with_seasons(q),
        )
        result["provider_counts"] = prov_counts
        result["provider_errors"] = prov_errors
        try:
            import multi_source
            result["available_providers"] = multi_source.get_provider_list()
        except ImportError:
            result["available_providers"] = []
        result["available_providers"].insert(0, {
            "key": "telegram", "label": "Telegram", "emoji": "📱", "type": "general",
        })
        return JSONResponse(result)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/discover/forward", dependencies=[Depends(require_admin)])
async def api_discover_forward(request: Request):
    """Forward manually selected files to the ATMOS pipeline."""
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


@router.post("/discover/auto-forward", dependencies=[Depends(require_admin)])
async def api_discover_auto_forward(request: Request):
    """Auto-search, auto-select best matches, auto-forward to pipeline."""
    data = await request.json()
    query = data.get("query", "").strip()
    if not query:
        return JSONResponse({"error": "Empty query"}, status_code=400)
    SOURCE_CHANNELS = _get_source_channels()
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
        search_result = await smart_search.smart_search(
            query=query, preferences=preferences,
            search_fn=search_fn,
            tmdb_fn=lambda q: _tmdb_lookup_with_seasons(q),
        )
        selected = search_result.get("selected", [])
        if not selected:
            return JSONResponse({
                "success": False, "message": "No files matched your criteria",
                "completeness": search_result.get("completeness", {}),
                "available_qualities": search_result.get("available_qualities", []),
                "available_languages": search_result.get("available_languages", []),
            })

        async def pull_fn(chat_id, message_id, file_name):
            return await telegram_bot.pull_from_channel(chat_id, message_id, file_name)
        forward_result = await smart_search.forward_to_pipeline(selected, pull_fn, rate_limit=2.0)
        return JSONResponse({
            "success": True, "query": query,
            "media_type": search_result.get("media_type", ""),
            "tmdb_title": search_result.get("tmdb", {}).get("title", ""),
            **forward_result,
            "completeness": search_result.get("completeness", {}),
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse({"error": str(e)}, status_code=500)


# ─── Torrent Search ──────────────────────────────────────────────

@router.get("/torrent-search")
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
