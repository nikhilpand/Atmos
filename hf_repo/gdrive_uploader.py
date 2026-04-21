import os
import json
import time
import hashlib
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from transfer_manager import TransferManager, _human_size

SCOPES = ['https://www.googleapis.com/auth/drive']

import threading

_creds_cache = None
_creds_lock = threading.Lock()  # [H6] Thread-safe credential access
_thread_local = threading.local()

def get_drive_service(credentials_json_str):
    """
    Initializes the Google Drive API client using a personal OAuth token.
    Handles automatic token refresh when the access token expires.
    [H6] Thread-safe: credential refresh is guarded by a lock.
    """
    global _creds_cache

    # Fast path: valid cache + thread-local service
    if _creds_cache and _creds_cache.valid and hasattr(_thread_local, 'service_cache'):
        return _thread_local.service_cache

    # Slow path: acquire lock for credential operations
    with _creds_lock:
        try:
            # Re-check after acquiring lock (double-checked locking)
            if _creds_cache and _creds_cache.valid and hasattr(_thread_local, 'service_cache'):
                return _thread_local.service_cache

            if _creds_cache and _creds_cache.expired and _creds_cache.refresh_token:
                print("\U0001f504 Refreshing expired OAuth token...")
                _creds_cache.refresh(Request())
                _thread_local.service_cache = build('drive', 'v3', credentials=_creds_cache)
                print("\u2705 Token refreshed successfully.")
                return _thread_local.service_cache

            creds_dict = json.loads(credentials_json_str)
            creds = Credentials.from_authorized_user_info(creds_dict, SCOPES)

            if creds.expired and creds.refresh_token:
                print("\U0001f504 Access token expired, refreshing...")
                creds.refresh(Request())
                print("\u2705 Token refreshed.")

            _creds_cache = creds
            service = build('drive', 'v3', credentials=creds)
            _thread_local.service_cache = service
            return service
        except Exception as e:
            if hasattr(_thread_local, 'service_cache'):
                del _thread_local.service_cache
            _creds_cache = None
            raise Exception(f"Failed to authenticate with Google Drive: {str(e)}")

_folder_cache = {}
_folder_cache_lock = threading.Lock()

def get_or_create_folder(service, folder_name, parent_id):
    """Checks if a folder exists in Google Drive under parent_id, creates it if not."""
    cache_key = f"{parent_id}:{folder_name}"
    
    with _folder_cache_lock:
        if cache_key in _folder_cache:
            return _folder_cache[cache_key]
            
    # Search for it
    # [C7] Escape single quotes in folder name to prevent Drive API query injection
    safe_name = folder_name.replace("'", "\\'")
    safe_parent = parent_id.replace("'", "\\'")
    query = f"name = '{safe_name}' and mimeType = 'application/vnd.google-apps.folder' and '{safe_parent}' in parents and trashed=false"
    results = service.files().list(q=query, spaces='drive', fields='files(id, name)').execute()
    items = results.get('files', [])
    
    if items:
        folder_id = items[0].get('id')
    else:
        # Create it
        file_metadata = {
            'name': folder_name,
            'mimeType': 'application/vnd.google-apps.folder',
            'parents': [parent_id]
        }
        folder = service.files().create(body=file_metadata, fields='id').execute()
        folder_id = folder.get('id')
        
    with _folder_cache_lock:
        _folder_cache[cache_key] = folder_id
        
    return folder_id

def create_hierarchy(service, root_id, folder_names):
    """
    Given a list of folder names (e.g. ['TV Shows', 'Breaking Bad', 'Season 5']),
    ensures they all exist sequentially inside the root_id directory.
    Returns the deepest folder ID.
    """
    current_parent = root_id
    for name in folder_names:
        if not name:
            continue
        current_parent = get_or_create_folder(service, name, current_parent)
    return current_parent


def check_duplicate(service, filename, folder_id=None):
    """
    Checks if a file with the same name already exists in the target Drive folder.
    Returns the existing file's metadata dict if found, or None.
    """
    try:
        # [C7] Escape single quotes to prevent Drive API query injection
        safe_filename = filename.replace("'", "\\'")
        query = f"name = '{safe_filename}' and trashed = false"
        if folder_id:
            safe_folder = folder_id.replace("'", "\\'")
            query += f" and '{safe_folder}' in parents"

        results = service.files().list(
            q=query,
            pageSize=1,
            fields="files(id, name, size, webViewLink)"
        ).execute()

        files = results.get('files', [])
        return files[0] if files else None
    except Exception as e:
        print(f"⚠️ Dedup check failed (proceeding anyway): {e}")
        return None


def upload_file_to_drive(service, file_path, folder_id=None, transfer_id=None, display_name=None):
    """
    Ultra Pro Max uploader: 256MB chunks, jittered exponential backoff, 10 retries.
    """
    import random
    tm = TransferManager()
    transfer = tm.get_transfer(transfer_id) if transfer_id else None

    if display_name:
        filename = display_name
    else:
        filename = os.path.basename(file_path)
        # Strip the persistent-queue job ID prefix (e.g., "abc12345_MovieName.mkv" → "MovieName.mkv")
        if '_' in filename and len(filename.split('_')[0]) == 8:
            filename = '_'.join(filename.split('_')[1:])

    file_size = os.path.getsize(file_path)
    file_metadata = {'name': filename}
    if folder_id:
        file_metadata['parents'] = [folder_id]

    # 256MB chunks — 18GB RAM can handle 4 workers × 256MB = 1GB easily
    chunk_size = 256 * 1024 * 1024
    # 1. Deduplication Check
    existing = check_duplicate(service, filename, folder_id)
    if existing:
        print(f"⏭️ Skipping {filename} (Already exists in Drive: {existing['id']})")
        if transfer:
            transfer.status = "completed"
            transfer.start_phase("File already exists. Linked.")
            transfer.update_progress(file_size, file_size)
        return existing['id']

    # 2. Resumable Upload
    media = MediaFileUpload(file_path, resumable=True, chunksize=chunk_size)

    request = service.files().create(
        body=file_metadata,
        media_body=media,
        fields='id,name,size,mimeType,webViewLink'
    )

    if transfer:
        transfer.status = "uploading"
        transfer.start_phase("Uploading to Google Drive")

    response = None
    retries = 0
    max_retries = 10  # More retries for resilience on long uploads

    while response is None:
        try:
            status, response = request.next_chunk()
            retries = 0  # Reset on success
            if status and transfer:
                uploaded = int(status.progress() * file_size)
                transfer.update_progress(uploaded, file_size)

                if status.progress() >= 0.99:
                    transfer.start_phase("Finalizing on Google Servers...")

        except Exception as e:
            retries += 1
            if retries > max_retries:
                raise Exception(f"Upload failed after {max_retries} retries: {str(e)}")
            # Jittered exponential backoff to prevent thundering herd
            base_wait = min(2 ** retries, 60)
            jitter = random.uniform(0, base_wait * 0.3)
            wait_time = base_wait + jitter
            print(f"⚠️ Upload chunk failed (attempt {retries}/{max_retries}), retrying in {wait_time:.1f}s: {e}")
            time.sleep(wait_time)

    file_id = response.get('id')
    print(f"✅ Upload complete: {filename} → {file_id}")

    # Auto-share so the frontend can stream it
    auto_share_file(service, file_id)

    return file_id


def auto_share_file(service, file_id):
    """Makes a file viewable by anyone with the link (required for iframe embed streaming)."""
    try:
        service.permissions().create(
            fileId=file_id,
            body={'type': 'anyone', 'role': 'reader'},
            fields='id'
        ).execute()
        print(f"🔗 Auto-shared file {file_id} as 'anyone with link'.")
    except Exception as e:
        print(f"⚠️ Auto-share failed (video may not stream on frontend): {e}")


def list_drive_folder(credentials_json_str, folder_id=None, page_size=100, recursive=True):
    """Lists files inside a Google Drive folder, optionally scanning subfolders."""
    service = get_drive_service(credentials_json_str)
    
    def _scan(fid, depth=0, current_path=""):
        if depth > 5: return []
        q = f"'{fid}' in parents and trashed = false"
        found = []
        page_token = None
        
        # [H10] Paginate through all results using nextPageToken
        while True:
            res = service.files().list(
                q=q,
                pageSize=100,
                pageToken=page_token,
                fields="nextPageToken, files(id, name, size, mimeType, modifiedTime, createdTime, thumbnailLink, originalFilename)"
            ).execute()
            
            for f in res.get('files', []):
                if f['mimeType'] == 'application/vnd.google-apps.folder':
                    if recursive:
                        new_path = f"{current_path}/{f['name']}" if current_path else f['name']
                        found.extend(_scan(f['id'], depth + 1, new_path))
                else:
                    f['folder_path'] = current_path
                    found.append(f)
            
            page_token = res.get('nextPageToken')
            if not page_token:
                break
        
        return found

    try:
        files = _scan(folder_id or 'root')
        # Sort by modified time descending manually since recursive results aren't sorted by Drive
        files.sort(key=lambda x: x.get('modifiedTime', ''), reverse=True)
        
        for f in files:
            raw_size = int(f.get('size', 0))
            f['size_human'] = _human_size(raw_size)
            f['size_bytes'] = raw_size
            f['embed_url'] = f"https://drive.google.com/file/d/{f['id']}/preview"
            f['thumbnail_url'] = f.get('thumbnailLink', f"https://drive.google.com/thumbnail?id={f['id']}&sz=w400")
        return files[:page_size]
    except Exception as e:
        print(f"Error listing Drive folder: {e}")
        return []


def get_drive_storage_info(credentials_json_str):
    """Returns storage quota information for the user's Drive."""
    service = get_drive_service(credentials_json_str)
    try:
        about = service.about().get(fields="storageQuota").execute()
        quota = about.get('storageQuota', {})
        used = int(quota.get('usage', 0))
        total = int(quota.get('limit', 0))
        return {
            "used": used,
            "total": total,
            "used_human": _human_size(used),
            "total_human": _human_size(total) if total else "Unlimited",
            "percent": round((used / total) * 100, 1) if total else 0,
        }
    except Exception as e:
        print(f"Error fetching Drive storage: {e}")
        return {"used": 0, "total": 0, "used_human": "N/A", "total_human": "N/A", "percent": 0}


def rename_file(credentials_json_str, file_id, new_name):
    """Renames a file in Google Drive."""
    service = get_drive_service(credentials_json_str)
    try:
        updated_file = service.files().update(
            fileId=file_id,
            body={'name': new_name},
            fields='id, name'
        ).execute()
        return updated_file
    except Exception as e:
        print(f"Error renaming file {file_id}: {e}")
        raise

def delete_file(credentials_json_str, file_id):
    """Deletes (trashes) a file in Google Drive."""
    service = get_drive_service(credentials_json_str)
    try:
        service.files().update(
            fileId=file_id,
            body={'trashed': True}
        ).execute()
        return True
    except Exception as e:
        print(f"Error deleting file {file_id}: {e}")
        raise
