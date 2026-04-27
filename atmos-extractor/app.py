"""
ATMOS Stream Extractor — Headless Browser Microservice
=======================================================
Uses real Chromium (Playwright) to navigate streaming provider embed pages
and intercept the actual .m3u8 / .mp4 network requests that their
obfuscated JS generates. Returns the real stream URL so Atmos can play
it natively with full HLS.js control.

Endpoints:
  GET /health           — liveness check
  GET /extract          — extract stream from a single provider embed URL
  GET /extract/tmdb     — build URL + extract for a given TMDB ID (convenience)
"""

import asyncio
import os
import re
import time
import json
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from playwright.async_api import async_playwright, Browser, BrowserContext, Page

# ─── Stealth wrapper (optional — graceful degrade if not installed) ───
try:
    from playwright_stealth import stealth_async
    HAS_STEALTH = True
except ImportError:
    HAS_STEALTH = False

# ─── Config ──────────────────────────────────────────────────────────
EXTRACTION_TIMEOUT_MS = 20_000      # 20s max per extraction
NAVIGATION_TIMEOUT_MS = 15_000      # 15s for page load
MAX_CONCURRENT = 3                  # max parallel extractions

# Patterns that indicate a real stream URL
STREAM_PATTERNS = [
    re.compile(r'\.m3u8(\?|$|#)'),
    re.compile(r'\.mp4(\?|$|#)'),
    re.compile(r'/hls/.*\.ts'),
    re.compile(r'manifest\.mpd'),
]

# Patterns to SKIP (ads, trackers, analytics)
SKIP_PATTERNS = [
    re.compile(r'google|doubleclick|analytics|gtag|facebook|pixel|ad\.js|ads\.js', re.I),
    re.compile(r'googlevideo\.com/videoplayback'),  # YouTube, not what we want
]

# Patterns that indicate we should ignore this URL as a stream
IGNORE_STREAM_PATTERNS = [
    re.compile(r'sample\.m3u8|test\.m3u8|example\.m3u8', re.I),
]

# Provider embed URL builders
PROVIDERS = [
    {
        "id": "vidsrc_icu",
        "name": "VidSrc ICU",
        "movie_url": "https://vidsrc.icu/embed/movie/{tmdb_id}",
        "tv_url": "https://vidsrc.icu/embed/tv/{tmdb_id}/{season}/{episode}",
        "referer": "https://vidsrc.icu/",
    },
    {
        "id": "8stream",
        "name": "8Stream",
        "movie_url": "https://8stream.com/embed/movie?tmdb={tmdb_id}",
        "tv_url": "https://8stream.com/embed/tv?tmdb={tmdb_id}&s={season}&e={episode}",
        "referer": "https://8stream.com/",
    },
    {
        "id": "vidsrc_dev",
        "name": "VidSrc Dev",
        "movie_url": "https://vidsrc.dev/embed/movie/{tmdb_id}",
        "tv_url": "https://vidsrc.dev/embed/tv/{tmdb_id}/{season}/{episode}",
        "referer": "https://vidsrc.dev/",
    },
    {
        "id": "autoembed",
        "name": "AutoEmbed",
        "movie_url": "https://autoembed.co/movie/tmdb/{tmdb_id}",
        "tv_url": "https://autoembed.co/tv/tmdb/{tmdb_id}-{season}-{episode}",
        "referer": "https://autoembed.co/",
    },
    {
        "id": "vidsrc_wtf",
        "name": "VidSrc WTF",
        "movie_url": "https://vidsrc.wtf/api/3/movie/?id={tmdb_id}",
        "tv_url": "https://vidsrc.wtf/api/3/tv/?id={tmdb_id}&s={season}&e={episode}",
        "referer": "https://vidsrc.wtf/",
    },
]

# ─── Global browser instance ──────────────────────────────────────────
_playwright = None
_browser: Optional[Browser] = None
_semaphore: Optional[asyncio.Semaphore] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start/stop global browser on app lifecycle."""
    global _playwright, _browser, _semaphore

    print("[ATMOS Extractor] Starting Chromium...")
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
            "--disable-features=IsolateOrigins,site-per-process",
        ],
    )
    _semaphore = asyncio.Semaphore(MAX_CONCURRENT)
    print("[ATMOS Extractor] Browser ready ✓")

    yield

    print("[ATMOS Extractor] Shutting down...")
    if _browser:
        await _browser.close()
    if _playwright:
        await _playwright.stop()


app = FastAPI(title="ATMOS Stream Extractor", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


# ─── Helpers ──────────────────────────────────────────────────────────

def is_stream_url(url: str) -> bool:
    """Check if a URL looks like a real video stream."""
    for pattern in SKIP_PATTERNS:
        if pattern.search(url):
            return False
    for pattern in IGNORE_STREAM_PATTERNS:
        if pattern.search(url):
            return False
    for pattern in STREAM_PATTERNS:
        if pattern.search(url):
            return True
    return False


def get_stream_type(url: str) -> str:
    if ".m3u8" in url or ".ts" in url or ".mpd" in url:
        return "hls"
    return "file"


async def extract_from_url(embed_url: str, referer: str) -> Optional[dict]:
    """
    Open embed_url in a new browser context, intercept stream requests.
    Returns dict with {url, type, headers} or None.
    """
    if not _browser:
        return None

    context: Optional[BrowserContext] = None
    captured = asyncio.Event()
    result: dict = {}

    try:
        context = await _browser.new_context(
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
        )

        page: Page = await context.new_page()

        # Apply stealth if available
        if HAS_STEALTH:
            await stealth_async(page)

        # Intercept ALL requests — capture first stream URL
        async def on_request(request):
            if captured.is_set():
                return
            url = request.url
            if is_stream_url(url):
                result["url"] = url
                result["type"] = get_stream_type(url)
                result["headers"] = dict(request.headers)
                # Remove sensitive headers before returning
                for h in ["cookie", "authorization"]:
                    result["headers"].pop(h, None)
                captured.set()

        page.on("request", on_request)

        # Also intercept responses in case headers differ
        async def on_response(response):
            if captured.is_set():
                return
            url = response.url
            if is_stream_url(url) and response.status < 400:
                result["url"] = url
                result["type"] = get_stream_type(url)
                result["headers"] = dict(response.headers)
                captured.set()

        page.on("response", on_response)

        # Navigate to the embed page
        try:
            await page.goto(
                embed_url,
                timeout=NAVIGATION_TIMEOUT_MS,
                wait_until="domcontentloaded",
            )
        except Exception as nav_err:
            print(f"[WARN] Navigation error for {embed_url}: {nav_err}")
            # Don't bail — the stream request may still fire after partial load

        # Wait for a stream URL to be captured, or timeout
        try:
            await asyncio.wait_for(captured.wait(), timeout=EXTRACTION_TIMEOUT_MS / 1000)
        except asyncio.TimeoutError:
            pass

        return result if result.get("url") else None

    except Exception as e:
        print(f"[ERROR] extract_from_url failed for {embed_url}: {e}")
        return None
    finally:
        if context:
            try:
                await context.close()
            except Exception:
                pass


def build_provider_url(provider: dict, tmdb_id: str, media_type: str, season: int = 0, episode: int = 0) -> str:
    """Build the embed URL for a given provider and media."""
    if media_type == "movie":
        template = provider["movie_url"]
        return template.replace("{tmdb_id}", tmdb_id)
    else:
        template = provider["tv_url"]
        return (
            template
            .replace("{tmdb_id}", tmdb_id)
            .replace("{season}", str(season))
            .replace("{episode}", str(episode))
        )


# ─── Routes ───────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "browser": "running" if _browser and _browser.is_connected() else "down",
        "stealth": HAS_STEALTH,
        "timestamp": time.time(),
    }


@app.get("/extract")
async def extract_direct(
    url: str = Query(..., description="Full embed URL to extract stream from"),
    referer: str = Query("", description="Referer header to send"),
):
    """
    Extract a stream URL directly from an embed URL.
    
    Example: /extract?url=https://vidsrc.icu/embed/tv/85552/1/3
    """
    if not url.startswith("http"):
        raise HTTPException(status_code=400, detail="Invalid URL")

    async with _semaphore:
        start = time.time()
        result = await extract_from_url(url, referer or url)

    if not result:
        raise HTTPException(status_code=404, detail="No stream found")

    return {
        "success": True,
        "stream": result,
        "extractionTimeMs": int((time.time() - start) * 1000),
        "sourceUrl": url,
    }


@app.get("/extract/tmdb")
async def extract_by_tmdb(
    id: str = Query(..., description="TMDB ID"),
    type: str = Query("movie", description="'movie' or 'tv'"),
    season: int = Query(0, description="Season number (TV only)"),
    episode: int = Query(0, description="Episode number (TV only)"),
):
    """
    Try all providers in order and return the first successful stream extraction.
    
    Example: /extract/tmdb?id=85552&type=tv&season=1&episode=3
    """
    if type == "tv" and (not season or not episode):
        raise HTTPException(status_code=400, detail="TV requires season and episode")

    start = time.time()
    errors = []

    for provider in PROVIDERS:
        embed_url = build_provider_url(provider, id, type, season, episode)
        referer = provider["referer"]

        print(f"[ATMOS] Trying {provider['name']}: {embed_url}")

        async with _semaphore:
            result = await extract_from_url(embed_url, referer)

        if result and result.get("url"):
            elapsed = int((time.time() - start) * 1000)
            print(f"[ATMOS] ✓ Got stream from {provider['name']} in {elapsed}ms")
            return {
                "success": True,
                "stream": {
                    **result,
                    "provider": provider["id"],
                    "providerName": provider["name"],
                },
                "extractionTimeMs": elapsed,
                "sourceUrl": embed_url,
            }
        else:
            msg = f"{provider['name']} failed"
            print(f"[ATMOS] ✗ {msg}")
            errors.append(msg)

    return JSONResponse(
        status_code=404,
        content={
            "success": False,
            "error": "No stream found from any provider",
            "providersChecked": len(PROVIDERS),
            "errors": errors,
            "extractionTimeMs": int((time.time() - start) * 1000),
        },
    )
