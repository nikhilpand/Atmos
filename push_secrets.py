"""
Push secrets to Hugging Face Space.
Reads all values from environment variables or a .env file — NEVER hardcode secrets.
"""
import subprocess
import sys
import os

# Ensure huggingface_hub is installed
try:
    from huggingface_hub import HfApi
except ImportError:
    print("Installing huggingface_hub...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "huggingface_hub"])
    from huggingface_hub import HfApi

# Try loading from .env file if python-dotenv is available
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # .env loading is optional — secrets can come from system env

# Configuration — all from environment variables
HF_TOKEN = os.environ.get("HF_TOKEN")
REPO_ID = os.environ.get("HF_REPO_ID", "nikhil1776/gdrivefwd")
CREDENTIALS_FILE = os.environ.get("GDRIVE_CREDENTIALS_FILE", "token.json")

if not HF_TOKEN:
    print("Error: HF_TOKEN environment variable is required.")
    print("Set it via: export HF_TOKEN=hf_yourtoken")
    sys.exit(1)

# All secrets to push — read from environment
SECRET_KEYS = [
    "TELEGRAM_USER_ID",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_API_HASH",
    "TELEGRAM_API_ID",
    "GDRIVE_FOLDER_ID",
    "TMDB_API_KEY",
    "TELEGRAM_SOURCE_CHANNELS",
    "USERBOT_SESSION",
    "DUMP_CHANNEL_ID",
]

secrets = {}
missing = []
for key in SECRET_KEYS:
    value = os.environ.get(key)
    if value:
        secrets[key] = value
    else:
        missing.append(key)

if missing:
    print(f"Warning: The following secrets are not set in environment: {', '.join(missing)}")
    print("They will be skipped. Set them via environment variables or a .env file.")

# Add Google Drive Credentials directly from the JSON file
if os.path.exists(CREDENTIALS_FILE):
    try:
        with open(CREDENTIALS_FILE, "r") as f:
            secrets["GDRIVE_CREDENTIALS"] = f.read()
    except Exception as e:
        print(f"Error reading {CREDENTIALS_FILE}: {e}")
        sys.exit(1)
else:
    print(f"Warning: Could not find credentials JSON at {CREDENTIALS_FILE}")
    print("GDRIVE_CREDENTIALS will not be pushed.")

if not secrets:
    print("Error: No secrets to push. Set environment variables first.")
    sys.exit(1)

# Push the secrets to Hugging Face
print("Initializing Hugging Face API...")
api = HfApi(token=HF_TOKEN)

print(f"Pushing {len(secrets)} secrets to {REPO_ID}...")
success_count = 0
for key, value in secrets.items():
    print(f" -> Setting secret: {key}...")
    try:
        api.add_space_secret(repo_id=REPO_ID, key=key, value=value)
        success_count += 1
    except Exception as e:
        print(f"    Failed to set {key}: {e}")

print(f"\n✅ {success_count}/{len(secrets)} secrets pushed successfully!")
print("Please go to Hugging Face and click 'Restart Space' for the new secrets to load.")
