"""
ATMOS Stream Extractor v3 — Dual-Engine: HTTP-first + Playwright fallback
=========================================================================
Strategy:
  1. Try pure-HTTP extraction with curl_cffi (Chrome TLS fingerprint) — fast, no bot detection
  2. Fall back to Playwright headless browser only if HTTP fails
  3. Race all providers in parallel, return first winner

curl_cffi impersonates real Chrome at the TLS layer → bypasses Cloudflare/bot detection
even from datacenter IPs.
"""

import asyncio
import os
import re
import time
import base64
import json
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from bs4 import BeautifulSoup

# ─── curl_cffi for browser-fingerprint HTTP ──────────────────────────
try:
    from curl_cffi.requests import AsyncSession
    HAS_CURL_CFFI = True
except ImportError:
    HAS_CURL_CFFI = False
    print("[Extractor] WARNING: curl_cffi not available, falling back to Playwright only")

# ─── Playwright ───────────────────────────────────────────────────────
try:
    from playwright.async_api import async_playwright, Browser, BrowserContext
    HAS_PLAYWRIGHT = True
except ImportError:
    HAS_PLAYWRIGHT = False

try:
    from playwright_stealth import stealth_async
    HAS_STEALTH = True
except ImportError:
    HAS_STEALTH = False

# ─── Config ──────────────────────────────────────────────────────────
NAV_TIMEOUT_MS   = 15_000
STREAM_WAIT_S    = 18
MAX_CONCURRENT   = 4
HTTP_TIMEOUT     = 12   # seconds for curl_cffi

STREAM_RE = re.compile(r'\.(m3u8|mp4|webm|mpd)(\?|$|&|#)', re.IGNORECASE)
SKIP_RE   = re.compile(
    r'(google|doubleclick|analytics|gtag|facebook|googlevideo\.com/videoplayback'
    r'|gstatic|googleapis|adsystem|pixel\.js|ads\.|cdn\.jsdelivr|cloudflare\.com/ajax)',
    re.IGNORECASE
)

# ─── Provider registry ────────────────────────────────────────────────
# Each provider has optional `http_extractor` for pure-HTTP extraction.
# Falls back to Playwright if http_extractor returns None.
PROVIDERS = [
    {
        "id": "vidsrc_icu",
        "name": "VidSrc ICU",
        "movie": "https://vidsrc.icu/embed/movie/{id}",
        "tv":    "https://vidsrc.icu/embed/tv/{id}/{s}/{e}",
        "ref":   "https://vidsrc.icu/",
        "http":  True,
    },
    {
        "id": "vidsrc_dev",
        "name": "VidSrc Dev",
        "movie": "https://vidsrc.dev/embed/movie/{id}",
        "tv":    "https://vidsrc.dev/embed/tv/{id}/{s}/{e}",
        "ref":   "https://vidsrc.dev/",
        "http":  True,
    },
    {
        "id": "autoembed",
        "name": "AutoEmbed",
        "movie": "https://autoembed.co/movie/tmdb/{id}",
        "tv":    "https://autoembed.co/tv/tmdb/{id}-{s}-{e}",
        "ref":   "https://autoembed.co/",
        "http":  True,
    },
    {
        "id": "2embed",
        "name": "2Embed",
        "movie": "https://www.2embed.cc/embed/{id}",
        "tv":    "https://www.2embed.cc/embedtv/{id}?s={s}&e={e}",
        "ref":   "https://www.2embed.cc/",
        "http":  True,
    },
    {
        "id": "nontongo",
        "name": "NonTongo",
        "movie": "https://nontongo.win/embed/movie/{id}",
        "tv":    "https://nontongo.win/embed/tv/{id}/{s}/{e}",
        "ref":   "https://nontongo.win/",
        "http":  True,
    },
    {
        "id": "vidjoy",
        "name": "VidJoy",
        "movie": "https://vidjoy.pro/embed/movie/{id}",
        "tv":    "https://vidjoy.pro/embed/tv/{id}/{s}/{e}",
        "ref":   "https://vidjoy.pro/",
        "http":  True,
    },
    {
        "id": "vidfast",
        "name": "VidFast",
        "movie": "https://vidfast.pro/movie/{id}",
        "tv":    "https://vidfast.pro/tv/{id}/{s}/{e}",
        "ref":   "https://vidfast.pro/",
        "http":  False,  # needs JS execution
    },
    {
        "id": "vidsrc_wtf",
        "name": "VidSrc WTF",
        "movie": "https://vidsrc.wtf/api/3/movie/?id={id}",
        "tv":    "https://vidsrc.wtf/api/3/tv/?id={id}&s={s}&e={e}",
        "ref":   "https://vidsrc.wtf/",
        "http":  True,
    },
    {
        "id": "111movies",
        "name": "111Movies",
        "movie": "https://111movies.com/movie/{id}",
        "tv":    "https://111movies.com/tv/{id}/{s}/{e}",
        "ref":   "https://111movies.com/",
        "http":  False,
    },
    {
        "id": "moviesapi",
        "name": "MoviesAPI",
        "movie": "https://moviesapi.club/movie/{id}",
        "tv":    "https://moviesapi.club/tv/{id}-{s}-{e}",
        "ref":   "https://moviesapi.club/",
        "http":  True,
    },
]

# ─── Globals ─────────────────────────────────────────────────────────
_playwright = None
_browser: Optional[Browser] = None
_semaphore: Optional[asyncio.Semaphore] = None
_cache: dict = {}
CACHE_TTL = 30 * 60  # 30 minutes


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _playwright, _browser, _semaphore
    _semaphore = asyncio.Semaphore(MAX_CONCURRENT)

    if HAS_PLAYWRIGHT:
        print("[Extractor] Launching Chromium (Playwright fallback)...")
        _playwright = await async_playwright().start()
        _browser = await _playwright.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--disable-web-security",
                "--disable-blink-features=AutomationControlled",
                "--disable-features=IsolateOrigins,site-per-process",
                "--window-size=1280,720",
            ],
        )
        print("[Extractor] Playwright ready ✓")

    print(f"[Extractor] Ready ✓  curl_cffi={HAS_CURL_CFFI}  playwright={HAS_PLAYWRIGHT}")
    yield

    if _browser:
        await _browser.close()
    if _playwright:
        await _playwright.stop()


app = FastAPI(title="ATMOS Stream Extractor", version="3.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])


# ═══════════════════════════════════════════════════════════════════════
# ENGINE 1 — Pure HTTP with curl_cffi (Chrome TLS fingerprint)
# ═══════════════════════════════════════════════════════════════════════

def _find_stream_in_html(html: str, base_url: str) -> Optional[dict]:
    """Scan HTML/JS for embedded m3u8 or mp4 URLs."""
    patterns = [
        # JSON-encoded stream URL
        r'"(https?://[^"]+\.m3u8[^"]*)"',
        r"'(https?://[^']+\.m3u8[^']*)'",
        # Direct URL in JS
        r'source["\s]*:["\s]*(https?://[^"\'>\s]+\.m3u8[^"\'>\s]*)',
        r'file["\s]*:["\s]*(https?://[^"\'>\s]+\.m3u8[^"\'>\s]*)',
        r'src["\s]*=["\s]*(https?://[^"\'>\s]+\.m3u8[^"\'>\s]*)',
        # MP4
        r'"(https?://[^"]+\.mp4[^"]*)"',
        r"'(https?://[^']+\.mp4[^']*)'",
    ]
    for pat in patterns:
        matches = re.findall(pat, html, re.IGNORECASE)
        for url in matches:
            url = url.strip()
            if SKIP_RE.search(url):
                continue
            if STREAM_RE.search(url):
                return {
                    "url": url,
                    "type": "hls" if ".m3u8" in url.lower() else "file",
                }
    return None


def _extract_iframes(html: str, base_url: str = "") -> list[str]:
    """Extract iframe src URLs from HTML."""
    soup = BeautifulSoup(html, "lxml")
    srcs = []
    for iframe in soup.find_all("iframe"):
        src = iframe.get("src", "")
        if src.startswith("//"):
            src = "https:" + src
        elif src.startswith("/") and base_url:
            from urllib.parse import urlparse
            parsed = urlparse(base_url)
            src = f"{parsed.scheme}://{parsed.netloc}{src}"
            
        if src and src.startswith("http"):
            srcs.append(src)
    return srcs


async def _http_get(session: "AsyncSession", url: str, referer: str) -> Optional[str]:
    """GET with browser fingerprint headers. Returns HTML or None."""
    try:
        resp = await session.get(
            url,
            headers={
                "Referer": referer,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "gzip, deflate, br",
                "Cache-Control": "no-cache",
                "Pragma": "no-cache",
            },
            timeout=HTTP_TIMEOUT,
            allow_redirects=True,
        )
        if resp.status_code < 400:
            return resp.text
    except Exception as e:
        print(f"[HTTP] GET {url} failed: {e}")
    return None


async def extract_vidsrc_cracked(embed_url: str, referer: str, provider_id: str) -> Optional[dict]:
    """Direct extraction crack for vidsrc.icu / cloudnestra pipeline."""
    if not HAS_CURL_CFFI:
        return None
        
    import urllib.parse
    
    async with AsyncSession(impersonate="chrome124") as session:
        # Step 1: Get vidsrcme iframe
        r1 = await _http_get(session, embed_url, referer)
        if not r1: 
            print("[Vidsrc Crack] Step 1 failed: No HTML returned")
            return None
        
        iframe_match = re.search(r'<iframe[^>]+src="([^"]+vidsrcme[^"]+)"', r1)
        if not iframe_match: 
            print("[Vidsrc Crack] Step 1 failed: No vidsrcme iframe found")
            return None
        iframe_url = iframe_match.group(1)
        if iframe_url.startswith('//'): iframe_url = 'https:' + iframe_url
        print(f"[Vidsrc Crack] Found iframe_url: {iframe_url}")
            
        # Step 2: Get vidsrcme page to find server hashes
        r2 = await _http_get(session, iframe_url, referer)
        if not r2: 
            print("[Vidsrc Crack] Step 2 failed: No HTML returned")
            return None
        
        servers = re.findall(r'<div[^>]*class="server"[^>]*data-hash="([^"]+)"[^>]*>([^<]+)</div>', r2)
        if not servers: 
            print("[Vidsrc Crack] Step 2 failed: No servers found")
            return None
        print(f"[Vidsrc Crack] Found servers: {len(servers)}")
        
        headers3 = {"Referer": "https://vidsrcme.vidsrc.icu/", "Origin": "https://vidsrcme.vidsrc.icu", "Accept": "*/*"}
        
        # Step 3: Hit cloudnestra RCP endpoints for each server
        for hash_val, name in servers:
            rcp_url = f"https://cloudnestra.com/rcp/{hash_val}"
            try:
                r3 = await session.get(rcp_url, headers=headers3, timeout=HTTP_TIMEOUT)
                r3_text = r3.text
                print(f"[Vidsrc Crack] Server {name.strip()} RCP Status: {r3.status_code}")
                
                # Check for iframe or window.location redirect to prorcp
                next_url = None
                
                iframe_src = re.search(r"src:\s*['\"]([^'\"]+)['\"]", r3_text)
                if iframe_src:
                    next_url = iframe_src.group(1)
                    print(f"[Vidsrc Crack] Found iframe_src: {next_url}")
                else:
                    redirect = re.search(r'window\.location\.replace\s*\(\s*["\']([^"\']+)["\']\s*\)', r3_text)
                    if redirect:
                        next_url = redirect.group(1)
                        print(f"[Vidsrc Crack] Found redirect: {next_url}")
                        
                if next_url:
                    if next_url.startswith('/'): next_url = 'https://cloudnestra.com' + next_url
                    elif next_url.startswith('//'): next_url = 'https:' + next_url
                    
                    r_pro = await session.get(next_url, headers=headers3, timeout=HTTP_TIMEOUT)
                    r_pro_text = r_pro.text
                    print(f"[Vidsrc Crack] ProRCP Status: {r_pro.status_code}")
                    
                    m3u8s = re.findall(r'(https?://[^\s"\'<>]+m3u8[^\s"\'<>]*)', r_pro_text)
                    if m3u8s:
                        stream_url = m3u8s[0]
                        pass_path = re.search(r'pass_path\s*=\s*["\']([^"\']+)["\']', r_pro_text)
                        if pass_path:
                            p_url = pass_path.group(1)
                            domain = urllib.parse.urlparse('https:' + p_url if p_url.startswith('//') else p_url).netloc
                            stream_url = stream_url.replace('{v1}', domain.replace('tmstr5.', ''))
                            
                        print(f"[HTTP] ✓ {provider_id} cracked stream natively via {name.strip()}")
                        return {
                            "url": stream_url,
                            "type": "hls",
                            "provider": provider_id,
                            "server": name.strip()
                        }
                    else:
                        print(f"[Vidsrc Crack] No m3u8 found in ProRCP response for {name.strip()}")
            except Exception as e:
                print(f"[Vidsrc Crack] Error on server {name.strip()}: {e}")
                
    return None


async def extract_http(embed_url: str, referer: str, provider_id: str) -> Optional[dict]:
    """Pure HTTP extraction — 2 levels deep (page → iframe → scan for m3u8)."""
    if not HAS_CURL_CFFI:
        return None

    async with AsyncSession(impersonate="chrome124") as session:
        # Level 1: fetch the embed page
        html = await _http_get(session, embed_url, referer)
        if not html:
            return None

        # Scan the embed page HTML directly
        found = _find_stream_in_html(html, embed_url)
        if found:
            found["provider"] = provider_id
            print(f"[HTTP] ✓ {provider_id} found stream in page HTML")
            return found

        # Level 2: follow iframes
        iframes = _extract_iframes(html, embed_url)
        for iframe_url in iframes[:3]:  # check up to 3 iframes
            iframe_html = await _http_get(session, iframe_url, embed_url)
            if not iframe_html:
                continue
            found = _find_stream_in_html(iframe_html, iframe_url)
            if found:
                found["provider"] = provider_id
                print(f"[HTTP] ✓ {provider_id} found stream in iframe HTML")
                return found

            # Level 3: nested iframes
            nested_iframes = _extract_iframes(iframe_html, iframe_url)
            for nested_url in nested_iframes[:2]:
                nested_html = await _http_get(session, nested_url, iframe_url)
                if nested_html:
                    found = _find_stream_in_html(nested_html, nested_url)
                    if found:
                        found["provider"] = provider_id
                        print(f"[HTTP] ✓ {provider_id} found stream in nested iframe")
                        return found

            # Level 3: check for JS files linked from iframe that may contain stream
            soup = BeautifulSoup(iframe_html, "lxml")
            for script in soup.find_all("script", src=True):
                src = script.get("src", "")
                if not src.startswith("http"):
                    continue
                if any(kw in src for kw in ["player", "embed", "stream", "source", "video"]):
                    js_html = await _http_get(session, src, iframe_url)
                    if js_html:
                        found = _find_stream_in_html(js_html, iframe_url)
                        if found:
                            found["provider"] = provider_id
                            print(f"[HTTP] ✓ {provider_id} found stream in JS file")
                            return found

    return None


# ═══════════════════════════════════════════════════════════════════════
# ENGINE 2 — Playwright headless browser (fallback)
# ═══════════════════════════════════════════════════════════════════════

async def extract_playwright(embed_url: str, referer: str, provider_id: str) -> Optional[dict]:
    """Playwright fallback — real browser with click simulation."""
    if not HAS_PLAYWRIGHT or not _browser:
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
                java_script_enabled=True,
            )

            page = await ctx.new_page()

            # Block ads and heavy resources
            async def handle_route(route):
                url = route.request.url
                rtype = route.request.resource_type
                if SKIP_RE.search(url):
                    await route.abort()
                elif rtype in ("image", "font", "stylesheet") and not STREAM_RE.search(url):
                    await route.abort()
                else:
                    await route.continue_()

            await page.route("**/*", handle_route)

            if HAS_STEALTH:
                await stealth_async(page)

            def on_request(request):
                if captured_event.is_set():
                    return
                url = request.url
                if STREAM_RE.search(url) and not SKIP_RE.search(url):
                    result.update({
                        "url": url,
                        "type": "hls" if ".m3u8" in url.lower() else "file",
                        "provider": provider_id,
                    })
                    captured_event.set()

            def on_response(response):
                if captured_event.is_set():
                    return
                url = response.url
                if STREAM_RE.search(url) and not SKIP_RE.search(url) and response.status < 400:
                    result.update({
                        "url": url,
                        "type": "hls" if ".m3u8" in url.lower() else "file",
                        "provider": provider_id,
                    })
                    captured_event.set()

            page.on("request", on_request)
            page.on("response", on_response)

            try:
                await page.goto(embed_url, timeout=NAV_TIMEOUT_MS, wait_until="domcontentloaded")
            except Exception:
                pass

            # ── Click simulation: find and click play buttons ──
            if not captured_event.is_set():
                play_selectors = [
                    "button.play", ".play-btn", ".btn-play", "#play-btn",
                    "[class*='play']", "[id*='play']", "button[aria-label*='play' i]",
                    ".jw-icon-playback", ".plyr__control--overlaid", ".vjs-big-play-button",
                    "button", "[role='button']", ".jw-video", "video"
                ]
                
                # Check main page and all iframes
                frames_to_check = [page] + page.frames
                for frame in frames_to_check:
                    if captured_event.is_set():
                        break
                    for sel in play_selectors:
                        if captured_event.is_set():
                            break
                        try:
                            el = await frame.query_selector(sel)
                            if el and await el.is_visible():
                                await el.click(timeout=1000)
                                await asyncio.sleep(0.5)
                        except Exception:
                            pass

            # Wait for stream
            try:
                await asyncio.wait_for(captured_event.wait(), timeout=STREAM_WAIT_S)
            except asyncio.TimeoutError:
                pass

        except Exception as e:
            print(f"[Playwright:{provider_id}] Error: {e}")
        finally:
            if ctx:
                try:
                    await ctx.close()
                except Exception:
                    pass

    return result if result.get("url") else None


# ═══════════════════════════════════════════════════════════════════════
# UNIFIED EXTRACTOR — HTTP first, Playwright fallback
# ═══════════════════════════════════════════════════════════════════════

async def extract_one(provider: dict, embed_url: str) -> Optional[dict]:
    """Try HTTP first, fall back to Playwright."""
    pid = provider["id"]
    ref = provider["ref"]

    # Engine 0: Specialized crack for vidsrc_icu (bypasses everything instantly)
    if pid == "vidsrc_icu" and HAS_CURL_CFFI:
        result = await extract_vidsrc_cracked(embed_url, ref, pid)
        if result:
            return result

    # Engine 1: pure HTTP (fast, no bot detection issues)
    if provider.get("http", True) and HAS_CURL_CFFI:
        result = await extract_http(embed_url, ref, pid)
        if result:
            return result

    # Engine 2: Playwright (slower, but handles JS-heavy providers)
    return await extract_playwright(embed_url, ref, pid)


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
        "curl_cffi": HAS_CURL_CFFI,
        "playwright": HAS_PLAYWRIGHT and bool(_browser and _browser.is_connected()),
        "stealth": HAS_STEALTH,
        "providers": len(PROVIDERS),
        "cached": len(_cache),
        "timestamp": time.time(),
    }


@app.get("/extract/tmdb")
async def extract_by_tmdb(
    id: str = Query(...),
    type: str = Query("movie"),
    season: int = Query(0),
    episode: int = Query(0),
):
    """Race all providers — HTTP first, Playwright fallback. First winner returned."""
    if type == "tv" and (not season or not episode):
        raise HTTPException(400, "TV requires season and episode")

    # Cache check
    cache_key = f"{id}:{type}:{season}:{episode}"
    cached = _cache.get(cache_key)
    if cached and time.time() - cached["ts"] < CACHE_TTL:
        print(f"[Cache] Hit for {cache_key}")
        return {"success": True, "stream": cached["stream"], "fromCache": True, "extractionTimeMs": 0}

    start = time.time()

    # Build all tasks
    tasks = [
        extract_one(p, build_url(p, type, id, season, episode))
        for p in PROVIDERS
    ]

    result = None
    for coro in asyncio.as_completed(tasks):
        res = await coro
        if res and res.get("url"):
            result = res
            break

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

    provider_name = next((p["name"] for p in PROVIDERS if p["id"] == result.get("provider")), "Unknown")
    stream = {**result, "providerName": provider_name}

    # Cache the result
    _cache[cache_key] = {"stream": stream, "ts": time.time()}
    # Evict old entries
    if len(_cache) > 500:
        oldest = sorted(_cache.items(), key=lambda x: x[1]["ts"])
        for k, _ in oldest[:100]:
            _cache.pop(k, None)

    return {
        "success": True,
        "stream": stream,
        "fromCache": False,
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

    # Try HTTP first
    result = None
    if HAS_CURL_CFFI:
        result = await extract_http(url, referer or url, "custom")

    # Playwright fallback
    if not result:
        result = await extract_playwright(url, referer or url, "custom")

    if not result:
        raise HTTPException(404, "No stream found")

    return {
        "success": True,
        "stream": result,
        "extractionTimeMs": int((time.time() - start) * 1000),
    }
