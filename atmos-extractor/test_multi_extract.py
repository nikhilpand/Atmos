import asyncio
import sys
from app import extract_playwright, _playwright, _browser, _semaphore, lifespan

async def main():
    class DummyApp:
        pass
    
    app = DummyApp()
    
    async with lifespan(app):
        res = await extract_playwright("https://multiembed.mov/directstream.php?video_id=27205&tmdb=1", "https://multiembed.mov/", "superembed")
        print("Result:", res)

asyncio.run(main())
