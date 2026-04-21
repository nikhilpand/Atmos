import asyncio
from playwright.async_api import async_playwright
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("Scraper")

# Global Playwright state
_playwright_instance = None
_browser = None

async def init_browser():
    """Starts the global headless Chromium browser instance."""
    global _playwright_instance, _browser
    if not _playwright_instance:
        logger.info("Initializing Playwright...")
        _playwright_instance = await async_playwright().start()
        _browser = await _playwright_instance.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-web-security"]
        )
        logger.info("Playwright browser ready.")

async def close_browser():
    """Cleans up the global browser instance."""
    global _playwright_instance, _browser
    if _browser:
        logger.info("Closing Playwright browser...")
        await _browser.close()
    if _playwright_instance:
        await _playwright_instance.stop()
    _browser = None
    _playwright_instance = None

async def extract_m3u8(tmdb_id: str, is_tv: bool = False, season: int = 1, episode: int = 1):
    """
    Headless extraction of .m3u8 streams using Playwright.
    Multi-fallback system to intercept raw streams from aggregators.
    """
    global _browser
    if not _browser:
        logger.error("Browser not initialized! Call init_browser() first.")
        return None

    providers = [
        # Primary mirrors for vidsrc
        f"https://vidsrc.me/embed/{'tv' if is_tv else 'movie'}?tmdb={tmdb_id}" + (f"&season={season}&episode={episode}" if is_tv else ""),
        f"https://vidsrc.in/embed/{'tv' if is_tv else 'movie'}/{tmdb_id}" + (f"/{season}/{episode}" if is_tv else ""),
        f"https://vidsrc.pm/embed/{'tv' if is_tv else 'movie'}?tmdb={tmdb_id}" + (f"&season={season}&episode={episode}" if is_tv else ""),
        f"https://vidsrc.net/embed/{'tv' if is_tv else 'movie'}/{tmdb_id}" + (f"/{season}/{episode}" if is_tv else ""),
        # Fallbacks
        f"https://autoembed.to/{'tv' if is_tv else 'movie'}/tmdb/{tmdb_id}" + (f"-{season}-{episode}" if is_tv else "")
    ]
    
    extracted_url = None
    
    # Launch a new tab/context using the persistent browser
    context = await _browser.new_context(
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
    
    try:
        for url in providers:
            logger.info(f"Trying provider: {url}")
            page = await context.new_page()
            
            # Setup network interception
            async def handle_response(response):
                nonlocal extracted_url
                if extracted_url:
                    return
                # Look for m3u8 playlists, specifically master.m3u8 or similar
                req_url = response.url
                if ".m3u8" in req_url and "master" not in req_url.lower() and response.status == 200:
                    pass
                if ".m3u8" in req_url and response.status == 200:
                    logger.info(f"Intercepted m3u8: {req_url}")
                    extracted_url = req_url
                    
            page.on("response", handle_response)
            
            try:
                await page.goto(url, wait_until="commit", timeout=5000)
                await asyncio.sleep(2)
                
                viewport = page.viewport_size
                if viewport:
                    x = viewport['width'] / 2
                    y = viewport['height'] / 2
                    for _ in range(3):
                        if extracted_url: break
                        await page.mouse.click(x, y)
                        await asyncio.sleep(1)
                
                for _ in range(10):
                    if extracted_url: break
                    await asyncio.sleep(0.5)
                    
            except Exception as e:
                logger.error(f"Error scraping {url}: {e}")
            finally:
                await page.close()
                
            if extracted_url:
                break
    finally:
        await context.close()
        
    return extracted_url

if __name__ == "__main__":
    # Test
    async def run_test():
        await init_browser()
        url = await extract_m3u8("550")
        print(f"Extracted: {url}")
        await close_browser()
    asyncio.run(run_test())
