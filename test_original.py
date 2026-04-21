import json
import sys
import os
from dotenv import load_dotenv

load_dotenv()

sys.path.append('hf_repo')
from hf_repo.app import GDRIVE_CREDENTIALS, GDRIVE_FOLDER_ID
from hf_repo.gdrive_uploader import list_drive_folder

files = list_drive_folder(GDRIVE_CREDENTIALS, GDRIVE_FOLDER_ID, recursive=True)

print(f"Total files found: {len(files)}")
for f in files:
    name = f.get('name')
    orig = f.get('originalFilename')
    if name == "Game of Thrones: The Last Watch.mkv":
        print(f"[{f.get('folder_path')}] Name: {name} | Orig: {orig}")

