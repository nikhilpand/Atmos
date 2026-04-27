import asyncio
import os
import sys

from app import extract_one, PROVIDERS, extract_by_tmdb, _playwright, _browser, _semaphore, lifespan

async def main():
    class DummyApp:
        pass
    
    app = DummyApp()
    
    async with lifespan(app):
        print("\n--- Testing Breaking Bad (TMDB: 1396, TV, S1E1) ---")
        res1 = await extract_by_tmdb(id="1396", type="tv", season=1, episode=1)
        print("Breaking Bad Result:", res1)

        print("\n--- Testing Frieren (TMDB: 114410, TV, S1E1) ---")
        res2 = await extract_by_tmdb(id="114410", type="tv", season=1, episode=1)
        print("Frieren Result:", res2)

if __name__ == "__main__":
    asyncio.run(main())
