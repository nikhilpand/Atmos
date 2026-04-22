"""Admin Drive Router — rename, delete, auto-rename, undo-rename, browse, mkdir, move, bulk ops, share-all"""

import os
import re
import threading
from fastapi import APIRouter, Request, Depends
from fastapi.responses import JSONResponse

from utils.auth import require_admin
from utils.human_size import human_size as _human_size
import metadata_fetcher
from media_classifier import MediaClassifier
from gdrive_uploader import (
    get_drive_service, list_drive_folder, auto_share_file,
    rename_file, delete_file, get_or_create_folder,
)

router = APIRouter()

GDRIVE_CREDENTIALS = os.environ.get("GDRIVE_CREDENTIALS", "")
GDRIVE_FOLDER_ID = os.environ.get("GDRIVE_FOLDER_ID", "")

# Shared reference to files router's cache for invalidation
_video_cache_lock = threading.Lock()
_video_cache = {"data": None, "timestamp": 0}


def _invalidate_video_cache():
    """Reset the video cache so next request triggers a fresh fetch."""
    global _video_cache
    # Also try to invalidate the files router cache via its module
    try:
        from routers import files as files_mod
        with files_mod._video_cache_lock:
            files_mod._video_cache = {"data": None, "timestamp": 0}
    except Exception:
        pass


# ─── Activity Feed (shared reference) ────────────────────────────
def _log_activity(icon, text, category="info"):
    """Try to log to the shared activity feed."""
    try:
        from routers.admin_system import log_activity
        log_activity(icon, text, category)
    except Exception:
        pass


@router.post("/rename/{file_id}", dependencies=[Depends(require_admin)])
async def api_admin_rename(file_id: str, request: Request):
    if not GDRIVE_CREDENTIALS:
        return JSONResponse({"error": "Not configured"}, status_code=500)
    if not re.match(r'^[a-zA-Z0-9_-]+$', file_id):
        return JSONResponse({"error": "Invalid file ID"}, status_code=400)
    try:
        data = await request.json()
        new_name = data.get("new_name")
        rename_file(GDRIVE_CREDENTIALS, file_id, new_name)
        return JSONResponse({"success": True, "new_name": new_name})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/delete/{file_id}", dependencies=[Depends(require_admin)])
async def api_admin_delete(file_id: str, request: Request):
    if not GDRIVE_CREDENTIALS:
        return JSONResponse({"error": "Not configured"}, status_code=500)
    if not re.match(r'^[a-zA-Z0-9_-]+$', file_id):
        return JSONResponse({"error": "Invalid file ID"}, status_code=400)
    try:
        delete_file(GDRIVE_CREDENTIALS, file_id)
        return JSONResponse({"success": True})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/auto-rename", dependencies=[Depends(require_admin)])
async def api_admin_auto_rename(request: Request):
    """Batch rename all Drive files using MediaClassifier + TMDB lookup."""
    if not GDRIVE_CREDENTIALS:
        return JSONResponse({"error": "Not configured"}, status_code=500)
    try:
        service = get_drive_service(GDRIVE_CREDENTIALS)

        def _get_all_files(fid, current_path=""):
            q = f"'{fid}' in parents and trashed = false"
            page_token = None
            found_files = []
            while True:
                res = service.files().list(
                    q=q, pageSize=1000, pageToken=page_token,
                    fields="nextPageToken, files(id, name, mimeType, originalFilename)"
                ).execute()
                for f in res.get('files', []):
                    if f['mimeType'] == 'application/vnd.google-apps.folder':
                        new_path = f"{current_path}/{f['name']}" if current_path else f['name']
                        found_files.extend(_get_all_files(f['id'], new_path))
                    else:
                        f['folder_path'] = current_path
                        found_files.append(f)
                page_token = res.get('nextPageToken')
                if not page_token:
                    break
            return found_files

        files = _get_all_files(GDRIVE_FOLDER_ID)
        video_extensions = {'.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv', '.m4v', '.ts'}
        renamed, skipped, errors = [], [], []

        for f in files:
            old_name = f.get('name', '')
            ext = os.path.splitext(old_name)[1].lower()
            mime = f.get('mimeType', '')
            if ext not in video_extensions and 'video' not in mime:
                continue
            try:
                folder_path = f.get('folder_path', '')
                folder_parts = [p.strip() for p in folder_path.split('/') if p.strip()]
                drive_show_title = ""
                drive_season = None
                if len(folder_parts) >= 2 and folder_parts[0].lower() == "tv shows":
                    drive_show_title = folder_parts[1]
                    if len(folder_parts) >= 3 and "season" in folder_parts[2].lower():
                        try:
                            drive_season = int(re.search(r'\d+', folder_parts[2]).group())
                        except Exception:
                            pass
                parsed = MediaClassifier.parse(old_name)
                if drive_show_title:
                    parsed['type'] = 'show'
                    parsed['title'] = drive_show_title
                    if drive_season and not parsed.get('season'):
                        parsed['season'] = drive_season
                raw_title = parsed.get("title") or ""
                if not raw_title or raw_title == "Unknown":
                    skipped.append({"id": f['id'], "name": old_name, "reason": "Could not parse title"})
                    continue
                m_type = "tv" if parsed["type"] in ["show", "anime"] else "movie"
                try:
                    meta = metadata_fetcher.get_metadata(raw_title, year=str(parsed.get('year', '')), media_type=m_type)
                    clean_title = meta.get("tmdb_title") or raw_title
                except Exception:
                    clean_title = raw_title
                clean_name = clean_title
                if parsed.get("type") in ["show", "anime"] and not parsed.get("episode"):
                    skipped.append({"id": f['id'], "name": old_name, "reason": "Missing episode number"})
                    continue
                if parsed.get("year"):
                    clean_name += f" ({parsed['year']})"
                if parsed.get("season"):
                    clean_name += f" S{parsed['season']:02d}E{parsed['episode']:02d}"
                elif parsed.get("episode"):
                    clean_name += f" Ep.{parsed['episode']}"
                if parsed.get("quality"):
                    clean_name += f" [{parsed['quality']}]"
                clean_name += ext or ".mkv"
                if clean_name.lower().strip() == old_name.lower().strip():
                    skipped.append({"id": f['id'], "name": old_name, "reason": "Already clean"})
                    continue
                print(f"✏️ Auto-Rename: '{old_name}' ➔ '{clean_name}'")
                rename_file(GDRIVE_CREDENTIALS, f['id'], clean_name)
                renamed.append({"id": f['id'], "old": old_name, "new": clean_name})
            except Exception as e:
                errors.append({"id": f['id'], "name": old_name, "error": str(e)[:200]})

        _invalidate_video_cache()
        return JSONResponse({
            "success": True, "renamed": len(renamed), "skipped": len(skipped), "errors": len(errors),
            "details": {"renamed": renamed[:50], "skipped": skipped[:20], "errors": errors[:20]}
        })
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/undo-rename", dependencies=[Depends(require_admin)])
async def api_admin_undo_rename(request: Request):
    """Revert ALL files to their original names."""
    if not GDRIVE_CREDENTIALS:
        return JSONResponse({"error": "Not configured"}, status_code=500)
    try:
        service = get_drive_service(GDRIVE_CREDENTIALS)

        def _get_all_files(fid):
            q = f"'{fid}' in parents and trashed = false"
            page_token = None
            found_files = []
            while True:
                res = service.files().list(
                    q=q, pageSize=1000, pageToken=page_token,
                    fields="nextPageToken, files(id, name, mimeType, originalFilename)"
                ).execute()
                for f in res.get('files', []):
                    if f['mimeType'] == 'application/vnd.google-apps.folder':
                        found_files.extend(_get_all_files(f['id']))
                    else:
                        found_files.append(f)
                page_token = res.get('nextPageToken')
                if not page_token:
                    break
            return found_files

        all_files = _get_all_files(GDRIVE_FOLDER_ID)
        restored, skipped_count = 0, 0
        for f in all_files:
            current_name = f.get('name')
            original_name = f.get('originalFilename')
            if original_name and current_name != original_name:
                rename_file(GDRIVE_CREDENTIALS, f['id'], original_name)
                restored += 1
            else:
                skipped_count += 1
        _invalidate_video_cache()
        return JSONResponse({"success": True, "restored": restored, "skipped": skipped_count})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse({"error": str(e)}, status_code=500)


# ─── Drive Explorer ──────────────────────────────────────────────

@router.get("/drive/browse", dependencies=[Depends(require_admin)])
def api_drive_browse(request: Request, folder_id: str = ""):
    if not GDRIVE_CREDENTIALS:
        return JSONResponse({"error": "Drive not configured"}, status_code=500)
    try:
        target = folder_id or GDRIVE_FOLDER_ID
        service = get_drive_service(GDRIVE_CREDENTIALS)
        q = f"'{target}' in parents and trashed = false"
        resp = service.files().list(
            q=q, fields="files(id,name,mimeType,size,modifiedTime)",
            orderBy="folder,name", pageSize=200
        ).execute()
        items = []
        for f in resp.get("files", []):
            is_folder = f["mimeType"] == "application/vnd.google-apps.folder"
            size_bytes = int(f.get("size", 0)) if not is_folder else 0
            items.append({
                "id": f["id"], "name": f["name"], "is_folder": is_folder,
                "size": _human_size(size_bytes) if size_bytes else "",
                "size_bytes": size_bytes, "modified": f.get("modifiedTime", "")[:10],
                "mime": f["mimeType"]
            })
        return JSONResponse({"files": items, "folder_id": target, "total": len(items)})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/drive/mkdir", dependencies=[Depends(require_admin)])
async def api_drive_mkdir(request: Request):
    if not GDRIVE_CREDENTIALS:
        return JSONResponse({"error": "Drive not configured"}, status_code=500)
    data = await request.json()
    name = data.get("name", "").strip()
    parent = data.get("parent_id", GDRIVE_FOLDER_ID)
    if not name:
        return JSONResponse({"error": "Folder name required"}, status_code=400)
    try:
        service = get_drive_service(GDRIVE_CREDENTIALS)
        folder_id = get_or_create_folder(service, name, parent)
        _log_activity("📁", f"Created folder: {name}", "drive")
        return JSONResponse({"success": True, "folder_id": folder_id, "name": name})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/drive/move", dependencies=[Depends(require_admin)])
async def api_drive_move(request: Request):
    if not GDRIVE_CREDENTIALS:
        return JSONResponse({"error": "Drive not configured"}, status_code=500)
    data = await request.json()
    file_id = data.get("file_id", "")
    new_parent = data.get("new_parent_id", "")
    if not file_id or not new_parent:
        return JSONResponse({"error": "file_id and new_parent_id required"}, status_code=400)
    if not re.match(r'^[a-zA-Z0-9_-]+$', file_id):
        return JSONResponse({"error": "Invalid file ID"}, status_code=400)
    try:
        service = get_drive_service(GDRIVE_CREDENTIALS)
        f = service.files().get(fileId=file_id, fields="parents").execute()
        old_parents = ",".join(f.get("parents", []))
        service.files().update(
            fileId=file_id, addParents=new_parent,
            removeParents=old_parents, fields="id,parents"
        ).execute()
        _log_activity("📦", f"Moved file {file_id}", "drive")
        return JSONResponse({"success": True})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ─── Bulk Operations ─────────────────────────────────────────────

@router.post("/bulk/rename", dependencies=[Depends(require_admin)])
async def api_bulk_rename(request: Request):
    if not GDRIVE_CREDENTIALS:
        return JSONResponse({"error": "Drive not configured"}, status_code=500)
    data = await request.json()
    renames = data.get("renames", [])
    if not renames or len(renames) > 100:
        return JSONResponse({"error": "Provide 1-100 renames"}, status_code=400)
    success, errors = 0, []
    for r in renames:
        try:
            rename_file(GDRIVE_CREDENTIALS, r["id"], r["new_name"])
            success += 1
        except Exception as e:
            errors.append({"id": r.get("id"), "error": str(e)})
    _log_activity("✏️", f"Bulk renamed {success} files", "bulk")
    return JSONResponse({"success": success, "errors": errors})


@router.post("/bulk/delete", dependencies=[Depends(require_admin)])
async def api_bulk_delete(request: Request):
    if not GDRIVE_CREDENTIALS:
        return JSONResponse({"error": "Drive not configured"}, status_code=500)
    data = await request.json()
    file_ids = data.get("file_ids", [])
    if not file_ids or len(file_ids) > 100:
        return JSONResponse({"error": "Provide 1-100 file IDs"}, status_code=400)
    success, errors = 0, []
    for fid in file_ids:
        if not re.match(r'^[a-zA-Z0-9_-]+$', fid):
            errors.append({"id": fid, "error": "Invalid ID"})
            continue
        try:
            delete_file(GDRIVE_CREDENTIALS, fid)
            success += 1
        except Exception as e:
            errors.append({"id": fid, "error": str(e)})
    _log_activity("🗑️", f"Bulk deleted {success} files", "bulk")
    return JSONResponse({"success": success, "errors": errors})


@router.post("/share-all", dependencies=[Depends(require_admin)])
async def api_admin_share_all(request: Request):
    if not GDRIVE_CREDENTIALS:
        return JSONResponse({"error": "Not configured"}, status_code=500)
    service = get_drive_service(GDRIVE_CREDENTIALS)
    files = list_drive_folder(GDRIVE_CREDENTIALS, GDRIVE_FOLDER_ID)
    shared = 0
    for f in files:
        try:
            auto_share_file(service, f['id'])
            shared += 1
        except Exception:
            pass
    return JSONResponse({"success": True, "shared": shared, "total": len(files)})
