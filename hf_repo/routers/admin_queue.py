"""Admin Queue Router — queue management, pull, pull-batch, clear_queue"""

import os
from fastapi import APIRouter, Request, Depends
from fastapi.responses import JSONResponse

from utils.auth import require_admin
from persistent_queue import PersistentQueue
import telegram_bot

router = APIRouter()

pq = PersistentQueue()


@router.get("/queue", dependencies=[Depends(require_admin)])
async def api_admin_queue(request: Request):
    """Get full persistent queue state."""
    return JSONResponse({"stats": pq.get_stats(), "jobs": pq.get_all()})


@router.post("/queue/retry/{job_id}", dependencies=[Depends(require_admin)])
async def api_admin_queue_retry(job_id: str, request: Request):
    """Manually retry a failed job."""
    success = pq.retry_job(job_id)
    if success:
        return JSONResponse({"success": True, "message": f"Job {job_id} requeued"})
    return JSONResponse({"error": "Job not found or not in failed state"}, status_code=404)


@router.post("/queue/clear", dependencies=[Depends(require_admin)])
async def api_admin_queue_clear(request: Request):
    """Clear all completed and failed jobs."""
    removed = pq.clear_finished()
    return JSONResponse({"success": True, "removed": removed})


@router.post("/clear_queue", dependencies=[Depends(require_admin)])
async def api_admin_clear_queue(request: Request):
    removed = pq.clear_finished()
    return JSONResponse({"success": True, "message": f"Cleared {removed} finished jobs."})


@router.post("/pull", dependencies=[Depends(require_admin)])
async def api_admin_pull(request: Request):
    """Pull a file from a source channel into the download queue."""
    data = await request.json()
    chat_id = data.get("chat_id")
    message_id = data.get("message_id")
    file_name = data.get("file_name", "")
    if not chat_id or not message_id:
        return JSONResponse({"error": "chat_id and message_id required"}, status_code=400)
    if not telegram_bot.app or not telegram_bot.app.is_initialized:
        return JSONResponse({"error": "Bot not running"}, status_code=503)
    try:
        result = await telegram_bot.pull_from_channel(int(chat_id), int(message_id), file_name)
        return JSONResponse({"success": True, **result})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/pull-batch", dependencies=[Depends(require_admin)])
async def api_admin_pull_batch(request: Request):
    """Pull multiple files at once (e.g., full season)."""
    data = await request.json()
    files = data.get("files", [])
    if not files:
        return JSONResponse({"error": "No files specified"}, status_code=400)
    MAX_BATCH_SIZE = 50
    if len(files) > MAX_BATCH_SIZE:
        return JSONResponse({"error": f"Batch too large. Maximum {MAX_BATCH_SIZE} files per request."}, status_code=400)
    if not telegram_bot.app or not telegram_bot.app.is_initialized:
        return JSONResponse({"error": "Bot not running"}, status_code=503)
    queued = 0
    errors = []
    for f in files:
        try:
            await telegram_bot.pull_from_channel(
                int(f["chat_id"]), int(f["message_id"]), f.get("file_name", "")
            )
            queued += 1
        except Exception as e:
            errors.append({"file": f.get("file_name", "?"), "error": str(e)})
    return JSONResponse({"success": True, "queued": queued, "errors": errors, "total": len(files)})


@router.post("/retry", dependencies=[Depends(require_admin)])
async def api_admin_retry(request: Request):
    try:
        data = await request.json()
        chat_id = data.get("chat_id")
        message_id = data.get("message_id")
        if not chat_id or not message_id:
            return JSONResponse({"error": "Missing chat_id or message_id"}, status_code=400)
        await telegram_bot.retry_transfer(chat_id, message_id)
        return JSONResponse({"success": True, "message": "Transfer re-queued successfully."})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
