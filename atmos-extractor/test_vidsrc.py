import asyncio
from curl_cffi.requests import AsyncSession
from app import extract_vidsrc_cracked
import logging

logging.basicConfig(level=logging.DEBUG)

async def main():
    res = await extract_vidsrc_cracked(
        "https://vidsrc.icu/embed/tv/1396/1/1",
        "https://vidsrc.icu/",
        "vidsrc_icu"
    )
    print("Result:", res)

asyncio.run(main())
