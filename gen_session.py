"""
Generate a Pyrogram session string for userbot channel searching.
Run this ONCE locally, then save the session string as USERBOT_SESSION in your .env file.

Reads API_ID and API_HASH from environment variables or .env file.
"""
from pyrogram import Client
import asyncio
import os

# Try loading from .env
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

API_ID = os.environ.get("TELEGRAM_API_ID")
API_HASH = os.environ.get("TELEGRAM_API_HASH")

if not API_ID or not API_HASH:
    print("Error: TELEGRAM_API_ID and TELEGRAM_API_HASH must be set.")
    print("Set them via environment variables or a .env file.")
    print("  export TELEGRAM_API_ID=12345678")
    print("  export TELEGRAM_API_HASH=your_hash_here")
    exit(1)

async def main():
    print("=" * 50)
    print("  ATMOS — Userbot Session Generator")
    print("=" * 50)
    print()
    print("This will log into your personal Telegram account")
    print("to enable searching public channels for files.")
    print("You'll receive a verification code in Telegram.")
    print()
    
    async with Client(":memory:", api_id=int(API_ID), api_hash=API_HASH) as app:
        session_string = await app.export_session_string()
        print("\n" + "=" * 50)
        print("✅ SESSION STRING (copy this entire line):")
        print("=" * 50)
        print(session_string)
        print("=" * 50)
        print("\nAdd this as USERBOT_SESSION in your .env file.")
        print("Then run push_secrets.py to push it to HF.")

if __name__ == "__main__":
    asyncio.run(main())
