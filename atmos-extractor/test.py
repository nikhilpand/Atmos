import asyncio
from app import extract_one, _playwright, _browser, _semaphore
from playwright.async_api import async_playwright

async def main():
    global _playwright, _browser, _semaphore
    _playwright = await async_playwright().start()
    _browser = await _playwright.chromium.launch(headless=False)
    _semaphore = asyncio.Semaphore(1)
    
    print("Testing vidsrc.icu...")
    res = await extract_one('https://vidsrc.icu/embed/movie/27205', 'https://vidsrc.icu/', 'vidsrc_icu')
    print("Result:", res)
    
    await _browser.close()
    await _playwright.stop()

if __name__ == "__main__":
    asyncio.run(main())
