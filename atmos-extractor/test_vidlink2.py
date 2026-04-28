import asyncio
from app import extract_one, lifespan

async def main():
    class DummyApp: pass
    app = DummyApp()
    async with lifespan(app):
        # build_url creates "https://vidlink.pro/tv/209867/1/6"
        p = {"id": "vidlink", "ref": "https://vidlink.pro/", "http": True}
        res = await extract_one(p, "https://vidlink.pro/tv/209867/1/6")
        print("Result:", res)

asyncio.run(main())
