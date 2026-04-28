import asyncio
from app import extract_one, lifespan

async def main():
    class DummyApp: pass
    app = DummyApp()
    async with lifespan(app):
        # embed_url, provider_id
        res = await extract_one("https://vidlink.pro/tv/209867/1/6", "vidlink")
        print("Result:", res)

asyncio.run(main())
