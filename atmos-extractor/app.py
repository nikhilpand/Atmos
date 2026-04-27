"""
ATMOS Stream Extractor v2 — Optimized Headless Browser Microservice
====================================================================
Races all providers in PARALLEL. Returns the first winner.
Tight timeouts so we respond within 25 seconds.
"""

import asyncio
import os
import re
import time
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from playwright.async_api import async_playwright, Browser, BrowserContext

# ─── Stealth (optional) ───────────────────────────────────────────────
try:
    from playwright_stealth import stealth_async
    HAS_STEALTH = True
except ImportError:
    HAS_STEALTH = False

# ─── Config ──────────────────────────────────────────────────────────
NAV_TIMEOUT_MS   = 12_000   # page load timeout
STREAM_WAIT_S    = 12       # seconds to wait for first m3u8/mp4 after load
MAX_CONCURRENT   = 6        # max parallel browser contexts

# Stream URL matchers
STREAM_RE = re.compile(
    r'\.(m3u8|mp4|webm|mpd)(\?|$|&|#)',
    re.IGNORECASE
)
SKIP_RE = re.compile(
    r'(google|doubleclick|analytics|gtag|facebook|googlevideo\.com/videoplayback'
    r'|gstatic|googleapis|adsystem|pixel\.js|ads\.)',
    re.IGNORECASE
)

# Providers ordered by reliability
PROVIDERS = [
    {
        "id": "vidsrc_icu",
        "name": "VidSrc ICU",
        "movie": "https://vidsrc.icu/embed/movie/{id}",
        "tv":    "https://vidsrc.icu/embed/tv/{id}/{s}/{e}",
        "ref":   "https://vidsrc.icu/",
    },
    {
        "id": "vidsrc_dev",
        "name": "VidSrc Dev",
        "movie": "https://vidsrc.dev/embed/movie/{id}",
        "tv":    "https://vidsrc.dev/embed/tv/{id}/{s}/{e}",
        "ref":   "https://vidsrc.dev/",
    },
    {
        "id": "autoembed",
        "name": "AutoEmbed",
        "movie": "https://autoembed.co/movie/tmdb/{id}",
        "tv":    "https://autoembed.co/tv/tmdb/{id}-{s}-{e}",
        "ref":   "https://autoembed.co/",
    },
    {
        "id": "vidsrc_cc",
        "name": "VidSrc CC",
        "movie": "https://vidsrc.cc/v2/embed/movie/{id}",
        "tv":    "https://vidsrc.cc/v2/embed/tv/{id}/{s}/{e}",
        "ref":   "https://vidsrc.cc/",
    },
    {
        "id": "multiembed",
        "name": "MultiEmbed",
        "movie": "https://multiembed.mov/?video_id={id}&tmdb=1",
        "tv":    "https://multiembed.mov/?video_id={id}&tmdb=1&s={s}&e={e}",
        "ref":   "https://multiembed.mov/",
    },
    {
        "id": "embedsoap",
        "name": "EmbedSoap",
        "movie": "https://www.embedsoap.com/embed/movie/?id={id}",
        "tv":    "https://www.embedsoap.com/embed/tv/?id={id}&s={s}&e={e}",
        "ref":   "https://www.embedsoap.com/",
    },
]

# ─── Globals ─────────────────────────────────────────────────────────
_playwright = None
_browser: Optional[Browser] = None
_semaphore: Optional[asyncio.Semaphore] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _playwright, _browser, _semaphore
    print("[Extractor] Launching Chromium...")
    _playwright = await async_playwright().start()
    _browser = await _playwright.chromium.launch(
        headless=True,
        args=[
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--no-first-run",
            "--no-zygote",
            "--disable-gpu",
            "--disable-web-security",
            "--disable-blink-features=AutomationControlled",
            "--disable-features=IsolateOrigins,site-per-process",
        ],
    )
    _semaphore = asyncio.Semaphore(MAX_CONCURRENT)
    print("[Extractor] Ready ✓")
    yield
    if _browser:
        await _browser.close()
    if _playwright:
        await _playwright.stop()


app = FastAPI(title="ATMOS Stream Extractor", version="2.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])


# ─── Core extractor ───────────────────────────────────────────────────

async def extract_one(embed_url: str, referer: str, provider_id: str) -> Optional[dict]:
    """Run real Chromium, intercept first stream URL. Returns dict or None."""
    if not _browser:
        return None

    captured_event = asyncio.Event()
    result: dict = {}

    async with _semaphore:
        ctx: Optional[BrowserContext] = None
        try:
            ctx = await _browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0.0.0 Safari/537.36"
                ),
                viewport={"width": 1280, "height": 720},
                locale="en-US",
                timezone_id="America/New_York",
                extra_http_headers={
                    "Referer": referer,
                    "Accept-Language": "en-US,en;q=0.9",
                },
                # Block images/fonts/css to speed up extraction
                java_script_enabled=True,
            )

            page = await ctx.new_page()

            # Block heavy resources we don't need
            await page.route("**/*", lambda route: (
                route.abort()
                if route.request.resource_type in ("image", "font", "stylesheet", "media")
                   and not STREAM_RE.search(route.request.url)
                else route.continue_()
            ))

            if HAS_STEALTH:
                await stealth_async(page)

            def on_request(request):
                if captured_event.is_set():
                    return
                url = request.url
                if STREAM_RE.search(url) and not SKIP_RE.search(url):
                    result["url"] = url
                    result["type"] = "hls" if ".m3u8" in url.lower() else "file"
                    result["provider"] = provider_id
                    result["headers"] = {
                        k: v for k, v in request.headers.items()
                        if k.lower() not in ("cookie", "authorization")
                    }
                    captured_event.set()

            def on_response(response):
                if captured_event.is_set():
                    return
                url = response.url
                if STREAM_RE.search(url) and not SKIP_RE.search(url) and response.status < 400:
                    result["url"] = url
                    result["type"] = "hls" if ".m3u8" in url.lower() else "file"
                    result["provider"] = provider_id
                    result["headers"] = dict(response.headers)
                    captured_event.set()

            page.on("request", on_request)
            page.on("response", on_response)

            try:
                await page.goto(embed_url, timeout=NAV_TIMEOUT_MS, wait_until="domcontentloaded")
            except Exception:
                pass  # page may be partial — stream requests can still fire

            # Wait for stream capture or timeout
            try:
                await asyncio.wait_for(captured_event.wait(), timeout=STREAM_WAIT_S)
            except asyncio.TimeoutError:
                pass

        except Exception as e:
            print(f"[{provider_id}] Error: {e}")
        finally:
            if ctx:
                try:
                    await ctx.close()
                except Exception:
                    pass

    return result if result.get("url") else None


def build_url(provider: dict, media_type: str, tmdb_id: str, season: int, episode: int) -> str:
    template = provider["movie"] if media_type == "movie" else provider["tv"]
    return (
        template
        .replace("{id}", tmdb_id)
        .replace("{s}", str(season))
        .replace("{e}", str(episode))
    )


# ─── Routes ───────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "browser": "running" if _browser and _browser.is_connected() else "down",
        "stealth": HAS_STEALTH,
        "providers": len(PROVIDERS),
        "timestamp": time.time(),
    }


@app.get("/extract/tmdb")
async def extract_by_tmdb(
    id: str = Query(...),
    type: str = Query("movie"),
    season: int = Query(0),
    episode: int = Query(0),
):
    """Race all providers in parallel — first m3u8/mp4 URL wins."""
    if type == "tv" and (not season or not episode):
        raise HTTPException(400, "TV requires season and episode")

    start = time.time()

    # Build tasks for all providers
    tasks = [
        extract_one(build_url(p, type, id, season, episode), p["ref"], p["id"])
        for p in PROVIDERS
    ]

    # Race them all — return first non-None result
    result = None
    for coro in asyncio.as_completed(tasks):
        res = await coro
        if res and res.get("url"):
            result = res
            break  # cancel remaining via garbage collection

    elapsed = int((time.time() - start) * 1000)

    if not result:
        return JSONResponse(
            status_code=404,
            content={
                "success": False,
                "error": "No stream found from any provider",
                "extractionTimeMs": elapsed,
            },
        )

    # Find provider name
    provider_name = next(
        (p["name"] for p in PROVIDERS if p["id"] == result.get("provider")), "Unknown"
    )

    return {
        "success": True,
        "stream": {**result, "providerName": provider_name},
        "extractionTimeMs": elapsed,
    }


@app.get("/extract")
async def extract_direct(
    url: str = Query(...),
    referer: str = Query(""),
):
    """Extract stream from any embed URL directly."""
    if not url.startswith("http"):
        raise HTTPException(400, "Invalid URL")
    start = time.time()
    result = await extract_one(url, referer or url, "custom")
    if not result:
        raise HTTPException(404, "No stream found")
    return {
        "success": True,
        "stream": result,
        "extractionTimeMs": int((time.time() - start) * 1000),
    }
