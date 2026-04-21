import os
import json
import asyncio
import re
from hf_repo.gdrive_uploader import get_drive_service
from hf_repo.media_classifier import MediaClassifier

# ─── Load Local Config ───
CREDENTIALS_FILE = "token.json"
GDRIVE_FOLDER_ID = "16kDGI-eI6ciuCuE1xlhTzN_vg4bhoKvG" # From push_secrets.py

if os.path.exists(CREDENTIALS_FILE):
    with open(CREDENTIALS_FILE, "r") as f:
        GDRIVE_CREDENTIALS = f.read()
else:
    print(f"❌ Error: {CREDENTIALS_FILE} not found locally.")
    exit(1)

def generate_clean_name(filename):
    """
    Takes a dirty filename and returns a clean, sorted name.
    """
    ext = os.path.splitext(filename)[1]
    parsed = MediaClassifier.parse(filename)
    
    title = parsed.get("title", "Unknown")
    
    if parsed["type"] in ["show", "anime"]:
        s = f"S{parsed.get('season', 1):02d}"
        e = f"E{parsed.get('episode', 1):02d}"
        return f"{title} - {s}{e}{ext}"
    else:
        year = f" ({parsed['year']})" if parsed.get("year") else ""
        return f"{title}{year}{ext}"

async def bulk_rename():
    print("🚀 Starting ATMOS Local Bulk Renaming...")
    service = get_drive_service(GDRIVE_CREDENTIALS)
    
    def get_all_files(fid):
        q = f"'{fid}' in parents and trashed = false"
        res = service.files().list(q=q, fields="files(id, name, mimeType)").execute()
        files = res.get('files', [])
        
        all_items = []
        for f in files:
            if f['mimeType'] == 'application/vnd.google-apps.folder':
                all_items.extend(get_all_files(f['id']))
            else:
                all_items.append(f)
        return all_items

    items = get_all_files(GDRIVE_FOLDER_ID)
    print(f"📂 Found {len(items)} files to process.")
    
    renamed_count = 0
    
    for item in items:
        file_id = item['id']
        old_name = item['name']
        
        # Skip if already clean (heuristic)
        if " - S0" in old_name or " - E0" in old_name:
            continue
            
        new_name = generate_clean_name(old_name)
        
        if new_name == old_name:
            continue
            
        print(f"📝 Renaming: {old_name} -> {new_name}")
        try:
            service.files().update(
                fileId=file_id,
                body={'name': new_name}
            ).execute()
            renamed_count += 1
        except Exception as e:
            print(f"❌ Failed to rename {old_name}: {e}")

    print(f"✨ Task Complete! Renamed {renamed_count} files.")

if __name__ == "__main__":
    asyncio.run(bulk_rename())
