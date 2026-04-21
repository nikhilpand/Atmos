import asyncio
from playwright.async_api import async_playwright

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        extracted = None
        page.on("response", lambda r: print("Found m3u8!" if ".m3u8" in r.url else "", end=""))
        await page.goto("https://vidsrc.net/embed/movie?tmdb=124364")
        await asyncio.sleep(5)
        print("\nDone")

asyncio.run(run())
