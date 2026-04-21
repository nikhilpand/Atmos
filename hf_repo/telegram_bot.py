import os
import shutil
import asyncio
import time
import re
from pyrogram import Client, filters
from pyrogram.handlers import MessageHandler
import pyrogram.utils
# Monkey-patch Pyrogram's bounds to support new channel IDs (e.g., -1002945758892)
pyrogram.utils.MIN_CHANNEL_ID = -1009999999999

import gdrive_uploader
from transfer_manager import TransferManager, _human_size
from persistent_queue import PersistentQueue
from media_classifier import MediaClassifier

print("Initializing Telegram Bot Configuration...")

# Optional Dump Channel ID for bypassing 2GB limits on hidden/direct uploads
# The user provided 1003992938782, but Telegram channel IDs MUST start with -100.
DUMP_CHANNEL_ID = os.environ.get("DUMP_CHANNEL_ID", "-1003992938782")

API_ID = os.environ.get("TELEGRAM_API_ID", "")
API_HASH = os.environ.get("TELEGRAM_API_HASH", "")
BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
ALLOWED_USER_ID = os.environ.get("TELEGRAM_USER_ID", "")

# [DEV Fallback] Load token.json from disk if env var is missing
GDRIVE_CREDENTIALS = os.environ.get("GDRIVE_CREDENTIALS", "")
if not GDRIVE_CREDENTIALS and os.path.exists("token.json"):
    with open("token.json", "r") as f:
        GDRIVE_CREDENTIALS = f.read()

GDRIVE_FOLDER_ID = os.environ.get("GDRIVE_FOLDER_ID", "")
USERBOT_SESSION = os.environ.get("USERBOT_SESSION", "")
BOT_SESSION = os.environ.get("BOT_SESSION", "") # NEW: Persistent bot session


app = None
userbot = None  # Secondary client for channel searching
tm = TransferManager()
pq = PersistentQueue()

# ═══════════════════════════════════════════════════════════════════
#  CONCURRENT PIPELINE — Sequential (1 worker)
# ═══════════════════════════════════════════════════════════════════

CONCURRENT_WORKERS = 1
STAGGER_DELAY = 2.5
_stagger_lock = asyncio.Lock() if False else None  # Will be initialized in async context
_worker_event = None  # Event to signal workers when new jobs arrive


async def pipeline_worker(worker_id: int):
    """A single concurrent worker that picks jobs from the persistent queue."""
    print(f"  \U0001f527 Worker-{worker_id} online")

    while True:
        try:
            # [H7] Fixed: Don't hold lock during sleep/wait
            # First check without lock if there might be work
            job = None
            async with _stagger_lock:
                job = pq.get_next_pending()
                if job:
                    # Wait before starting the download to avoid Telegram rate limits
                    await asyncio.sleep(STAGGER_DELAY)

            if not job:
                # No jobs available — wait for notification or poll every 5s (lock-free)
                if _worker_event:
                    try:
                        await asyncio.wait_for(_worker_event.wait(), timeout=5.0)
                        _worker_event.clear()
                    except asyncio.TimeoutError:
                        pass
                else:
                    await asyncio.sleep(5)
                continue

            # Job found and staggered — execute it
            await _execute_job(worker_id, job)

        except Exception as e:
            print(f"\u26a0\ufe0f Worker-{worker_id} error: {e}")
            await asyncio.sleep(3)


async def _ws_notify(event: dict):
    """Send real-time event to admin WebSocket clients (best-effort)."""
    try:
        from app import ws_broadcast
        await ws_broadcast(event)
    except Exception:
        pass

async def _execute_job(worker_id: int, job: dict):
    """Execute a single download→upload job with full error handling."""
    job_id = job["id"]
    file_name = job["file_name"]
    clean_name = job.get("clean_name", file_name)
    chat_id = job["chat_id"]
    message_id = job["message_id"]
    file_size = job.get("file_size", 0)
    gdrive_hierarchy = job.get("gdrive_hierarchy", [])

    size_str = _human_size(file_size) if file_size else "unknown"
    print(f"🔽 Worker-{worker_id} starting: {clean_name} ({size_str})")
    
    await _ws_notify({"type": "job_start", "job_id": job_id, "name": clean_name, "size": size_str, "worker": worker_id})

    # Send status message to user
    status_msg = None
    if ALLOWED_USER_ID:
        try:
            status_msg = await app.send_message(
                int(ALLOWED_USER_ID),
                f"⚡ **Worker-{worker_id}** starting\n"
                f"`{clean_name}`\n"
                f"📁 `{' / '.join(gdrive_hierarchy) or 'Root'}`\n"
                f"📦 {size_str}"
            )
        except Exception:
            pass

    try:
        os.makedirs("downloads", exist_ok=True)

        # [H4] Check disk space before downloading
        disk = shutil.disk_usage("downloads")
        required = file_size * 1.1 if file_size else 500 * 1024 * 1024  # need 10% margin, or 500MB min
        if disk.free < required:
            pq.mark_failed(job_id, f"Insufficient disk space: {_human_size(disk.free)} free, need {_human_size(int(required))}")
            if status_msg:
                await status_msg.edit_text(f"\u274c `{file_name}`\n\nInsufficient disk space.")
            return

        # Pre-validate Google Drive auth
        if not GDRIVE_CREDENTIALS:
            pq.mark_failed(job_id, "GDRIVE_CREDENTIALS not configured")
            if status_msg:
                await status_msg.edit_text(f"❌ `{file_name}`\n\nGDRIVE_CREDENTIALS not configured.")
            return

        try:
            service = gdrive_uploader.get_drive_service(GDRIVE_CREDENTIALS)
        except Exception as e:
            pq.mark_failed(job_id, f"GDrive auth failed: {e}")
            if status_msg:
                await status_msg.edit_text(f"❌ `{file_name}`\n\nGDrive auth failed: {str(e)[:200]}")
            return

        # Dedup check
        existing = gdrive_uploader.check_duplicate(service, file_name, GDRIVE_FOLDER_ID)
        if existing:
            existing_size = _human_size(int(existing.get('size', 0)))
            pq.mark_complete(job_id, gdrive_file_id=existing.get('id'))
            if status_msg:
                await status_msg.edit_text(
                    f"🔁 **Duplicate skipped:** `{file_name}`\n"
                    f"📊 Already on Drive ({existing_size})"
                )
            return

        # ════════ PHASE 1: Download from Telegram ════════
        pq.update_job(job_id, status="downloading", phase="Downloading from Telegram")

        # Fetch the message
        msg = None
        client_to_use = app
        
        # If the file is > 1.9GB, the bot CANNOT download it. We must use the userbot.
        if file_size > 1.9 * 1024 * 1024 * 1024:
            if userbot and userbot.is_initialized:
                client_to_use = userbot
                print(f"File {file_name} is > 1.9GB, switching to userbot.")
            else:
                err = "Userbot session is required for files > 2.0GB (Bot client limit)"
                print(f"❌ {err}")
                pq.mark_failed(job_id, err)
                if status_msg:
                    await status_msg.edit_text(f"❌ `{file_name}`\n\n{err}")
                return

        for attempt in range(3):
            try:
                # SAFE RESOLVER: Wrapped to prevent crashing on unresolvable peers
                msg = await client_to_use.get_messages(chat_id, message_id)
                if msg and not getattr(msg, 'empty', True):
                    break
            except (ValueError, KeyError) as e:
                print(f"⚠️ Peer Resolution Error (Attempt {attempt+1}/3): {e}")
                # If bot failed, try switching to userbot immediately for resolution
                if client_to_use == app and userbot and userbot.is_initialized:
                    print("🔄 Switching to Userbot for peer resolution...")
                    client_to_use = userbot
                    continue
                await asyncio.sleep(1)
            except Exception as e:
                err = str(e)
                if "FLOOD_WAIT" in err or "flood" in err.lower():
                    wait_match = re.search(r'(\d+)', err)
                    wait_secs = int(wait_match.group(1)) if wait_match else 30
                    print(f"⏳ Worker-{worker_id} FloodWait {wait_secs}s")
                    pq.update_job(job_id, phase=f"FloodWait {wait_secs}s")
                    await asyncio.sleep(wait_secs + 2)
                else:
                    await asyncio.sleep(2 ** attempt)

        # Final Fallback Attempt
        if (not msg or getattr(msg, 'empty', True)) and userbot and userbot.is_initialized:
            try:
                msg = await userbot.get_messages(chat_id, message_id)
            except Exception as e:
                print(f"⚠️ Final userbot fallback failed: {e}")

        if not msg or getattr(msg, 'empty', True):
            pq.mark_failed(job_id, "Could not fetch message")
            if status_msg:
                try:
                    await status_msg.edit_text(f"❌ `{file_name}`\n\nCould not fetch message.")
                except Exception:
                    pass
            return

        # Create a transfer object for dashboard tracking BEFORE downloading starts
        transfer = tm.create_transfer(f"channel:{chat_id}", file_name, "pipeline")
        transfer.file_size = msg.document.file_size if msg.document else (msg.video.file_size if msg.video else file_size)
        transfer.status = "downloading"
        transfer.phase = "Downloading from Telegram"

        local_path = f"downloads/{job_id}_{file_name}"
        dl_start = time.time()
        last_update = [0]
        last_edit_time = [0]  # [M9] Track last message edit time

        async def progress_callback(current, total):
            pct = int((current / total) * 100) if total else 0
            transfer.update_progress(current, total)
            transfer.status = "downloading"
            transfer.phase = "Downloading from Telegram"

            # Don't persist every tick — only update in-memory (saves disk I/O)
            pq.update_job(job_id, persist=False, progress=pct, phase="Downloading from Telegram")

            # [V2] Throttle edits: only update every 10% AND at least 5s apart
            now = time.time()
            if pct - last_update[0] >= 10 and (now - last_edit_time[0]) >= 5.0:
                last_update[0] = pct
                last_edit_time[0] = now
                elapsed = time.time() - dl_start
                speed = current / elapsed if elapsed > 0 else 0
                remaining = (total - current) / speed if speed > 0 else 0
                eta_min = int(remaining // 60)
                eta_sec = int(remaining % 60)
                bar = "\u2588" * (pct // 10) + "\u2591" * (10 - (pct // 10))

                if status_msg:
                    try:
                        await status_msg.edit_text(
                            f"\u2b07\ufe0f **W-{worker_id} Downloading**\n"
                            f"`{file_name}`\n\n"
                            f"[{bar}] {pct}%\n"
                            f"\U0001f4e6 {_human_size(current)} / {_human_size(total)}\n"
                            f"\U0001f680 {_human_size(speed)}/s\n"
                            f"\u23f1\ufe0f ETA: {eta_min}m {eta_sec}s"
                        )
                    except Exception:
                        pass

        # V3: Reverted to native sequential downloader for maximum stability
        await msg.download(
            file_name=local_path,
            progress=progress_callback
        )

        actual_size = os.path.getsize(local_path)
        dl_elapsed = time.time() - dl_start
        dl_speed = actual_size / dl_elapsed if dl_elapsed > 0 else 0

        # ════════ PHASE 2: Upload to Google Drive ════════
        pq.update_job(job_id, status="uploading", phase="Uploading to Google Drive", progress=0)

        if status_msg:
            try:
                await status_msg.edit_text(
                    f"✅ **Download done!** ({_human_size(dl_speed)}/s)\n"
                    f"`{file_name}`\n\n"
                    f"☁️ **Uploading to Google Drive...**"
                )
            except Exception:
                pass

        # Update transfer state for the upload phase
        transfer.file_size = actual_size
        transfer.status = "uploading"
        transfer.phase = "Uploading to Google Drive"
        transfer.uploaded_bytes = 0

        up_start = time.time()
        upload_done = asyncio.Event()

        async def upload_progress_updater():
            """Updates Telegram message with upload progress every 5 seconds."""
            last_text = ""
            while not upload_done.is_set():
                up_pct = int((transfer.uploaded_bytes / actual_size) * 100) if actual_size else 0
                up_bar = "█" * (up_pct // 10) + "░" * (10 - (up_pct // 10))
                elapsed = time.time() - up_start
                up_speed = transfer.uploaded_bytes / elapsed if elapsed > 0 else 0
                remaining = (actual_size - transfer.uploaded_bytes) / up_speed if up_speed > 0 else 0
                eta_min = int(remaining // 60)
                eta_sec = int(remaining % 60)

                pq.update_job(job_id, progress=up_pct, phase="Uploading to Google Drive",
                              speed=up_speed, uploaded_bytes=transfer.uploaded_bytes)

                text = (
                    f"☁️ **W-{worker_id} Uploading**\n"
                    f"`{file_name}`\n\n"
                    f"[{up_bar}] {up_pct}%\n"
                    f"📦 {_human_size(transfer.uploaded_bytes)} / {_human_size(actual_size)}\n"
                    f"🚀 {_human_size(up_speed)}/s\n"
                    f"⏱️ ETA: {eta_min}m {eta_sec}s"
                )
                if text != last_text and status_msg:
                    try:
                        await status_msg.edit_text(text)
                        last_text = text
                    except Exception:
                        pass
                await asyncio.sleep(5)

        # Determine the target Google Drive folder using dynamic hierarchical creation
        target_folder_id = GDRIVE_FOLDER_ID
        if gdrive_hierarchy:
            pq.update_job(job_id, phase=f"Constructing Drive Path: {' / '.join(gdrive_hierarchy)}")
            target_folder_id = await asyncio.to_thread(gdrive_uploader.create_hierarchy, service, GDRIVE_FOLDER_ID, gdrive_hierarchy)

        pq.update_job(job_id, phase="Uploading to Drive")
        
        updater_task = asyncio.create_task(upload_progress_updater())

        gdrive_file_id = await asyncio.to_thread(
            gdrive_uploader.upload_file_to_drive,
            service, local_path, target_folder_id, transfer.id,
            display_name=clean_name
        )

        upload_done.set()
        updater_task.cancel()

        up_elapsed = time.time() - up_start
        up_speed = actual_size / up_elapsed if up_elapsed > 0 else 0
        total_elapsed = time.time() - dl_start

        # Cleanup local file
        if os.path.exists(local_path):
            os.remove(local_path)

        # Mark complete in persistent queue
        pq.mark_complete(job_id, gdrive_file_id=gdrive_file_id)
        tm.complete_transfer(transfer.id, gdrive_file_id=gdrive_file_id)

        # Final summary
        if status_msg:
            try:
                await status_msg.edit_text(
                    f"✅ **Transfer Complete!**\n"
                    f"`{file_name}`\n\n"
                    f"📊 **Summary:**\n"
                    f"  📦 Size: {_human_size(actual_size)}\n"
                    f"  ⬇️ DL: {int(dl_elapsed)}s @ {_human_size(dl_speed)}/s\n"
                    f"  ☁️ UL: {int(up_elapsed)}s @ {_human_size(up_speed)}/s\n"
                    f"  ⏱️ Total: {int(total_elapsed)}s\n"
                    f"  📁 Drive ID: `{gdrive_file_id}`"
                )
            except Exception:
                pass

        print(f"✅ Worker-{worker_id} done: {file_name} in {int(total_elapsed)}s")
        await _ws_notify({"type": "job_complete", "job_id": job_id, "name": clean_name, "elapsed": int(total_elapsed), "size": _human_size(actual_size)})

    except Exception as e:
        err_msg = str(e)
        print(f"❌ Worker-{worker_id} failed: {file_name} — {err_msg}")
        await _ws_notify({"type": "job_failed", "job_id": job_id, "name": clean_name, "error": err_msg[:200]})

        # Clean up partial download
        local_path_guess = f"downloads/{job_id}_{file_name}"
        if os.path.exists(local_path_guess):
            os.remove(local_path_guess)

        retrying = pq.mark_failed(job_id, err_msg)
        if status_msg:
            try:
                retry_note = f"\n🔄 Will auto-retry (attempt {pq.get_job(job_id)['retry_count']}/3)" if retrying else ""
                await status_msg.edit_text(
                    f"❌ **Failed:** `{file_name}`\n\n"
                    f"Error: {err_msg[:300]}{retry_note}"
                )
            except Exception:
                pass

        # Signal workers to pick up the retried job
        if retrying and _worker_event:
            _worker_event.set()


# ═══════════════════════════════════════════════════════════════════
#  MESSAGE HANDLERS (for direct file sends to the bot)
# ═══════════════════════════════════════════════════════════════════

def owner_filter(_, __, message):
    if not ALLOWED_USER_ID:
        return True
    return str(message.from_user.id) == str(ALLOWED_USER_ID)

is_owner = filters.create(owner_filter)


async def handle_file(client, message, file_info):
    """Enqueues a file transfer job into the persistent queue."""
    file_name = getattr(file_info, "file_name", None)
    file_size = getattr(file_info, "file_size", 0)

    if not file_name:
        ext = ".mp4" if message.video else ".bin"
        file_name = f"telegram_{message.id}{ext}"
        
    # Classify the media
    parsed = MediaClassifier.parse(file_name)
    raw_title = parsed["title"] or "Unknown"
    media_type = parsed["type"]
    
    # TMDB auto-rename: fetch official title for accuracy
    tmdb_type = "tv" if media_type in ["show", "anime"] else "movie"
    try:
        import metadata_fetcher
        meta = metadata_fetcher.get_metadata(raw_title, year=str(parsed.get('year', '')), media_type=tmdb_type)
        clean_name = meta.get("tmdb_title") or raw_title
    except Exception:
        clean_name = raw_title
    
    if parsed.get("year"):
        clean_name += f" ({parsed['year']})"
    if parsed.get("season"):
        clean_name += f" S{parsed['season']:02d}E{parsed['episode']:02d}"
    elif parsed.get("episode"):
        clean_name += f" Ep.{parsed['episode']}"
    if parsed.get("quality"):
        clean_name += f" [{parsed['quality']}]"
    ext = os.path.splitext(file_name)[1] or ".mkv"
    clean_name += ext
    
    # SAFEGUARD: If it's classified as a show/anime but no episode was found,
    # it means our parser failed. We MUST NOT use clean_name, we must fallback to the raw file_name.
    # Otherwise, all episodes of a show get uploaded with the exact same name.
    if media_type in ["show", "anime"] and not parsed.get("episode"):
        print(f"⚠️ Parser missed episode number for TV Show. Falling back to original filename: '{file_name}'")
        clean_name = file_name
        
    gdrive_hierarchy = MediaClassifier.generate_gdrive_path(parsed, include_season=True)

    # If file is large (>1.9GB), we will attempt to use the userbot during the download phase.
    # We prefer the original source if available to ensure access.
    target_chat_id = message.chat.id
    target_message_id = message.id
    
    if file_size > 1.9 * 1024 * 1024 * 1024:
        if getattr(message, "forward_from_chat", None) and getattr(message, "forward_from_message_id", None):
            target_chat_id = message.forward_from_chat.id
            target_message_id = message.forward_from_message_id
            print(f"File > 1.9GB. Using original source for userbot: {target_chat_id}:{target_message_id}")
        elif DUMP_CHANNEL_ID:
            print(f"File > 1.9GB but source hidden. Forwarding to Dump Channel {DUMP_CHANNEL_ID}")
            try:
                # Forward to the dump channel so both Bot and Userbot have a shared, global message ID
                fwd_msg = await message.forward(int(DUMP_CHANNEL_ID))
                target_chat_id = int(DUMP_CHANNEL_ID)
                target_message_id = fwd_msg.id
                print(f"✅ Forwarded successfully. New target: {target_chat_id}:{target_message_id}")
            except Exception as e:
                err = f"❌ **Error:** Failed to forward massive file to Dump Channel. Is the bot an admin there? Error: {e}"
                print(err)
                await message.reply_text(err)
                return
        else:
            err = "❌ **Error:** Files larger than 1.9GB must be forwarded from a **Public Channel** so the userbot can access them. Hidden sources or direct uploads to the bot are not supported for massive files due to Telegram API limits.\n\n*(Tip: Configure DUMP_CHANNEL_ID to bypass this)*"
            print(f"File > 1.9GB but source hidden. Rejecting.")
            await message.reply_text(err)
            return

    # Add to persistent queue
    job = pq.add_job(
        chat_id=target_chat_id,
        message_id=target_message_id,
        file_name=file_name,
        file_size=file_size,
        source_channel=f"@{message.from_user.username or message.from_user.id}",
        clean_name=clean_name,
        media_type=media_type
    )
    pq.update_job(job["id"], gdrive_hierarchy=gdrive_hierarchy)

    size_str = _human_size(file_size) if file_size else "unknown"
    pending = pq.pending_count()

    await message.reply_text(
        f"📋 **Queued** `{file_name}` ({size_str})\n"
        f"🔢 Pending: {pending} job(s)\n"
        f"📋 Job ID: `{job['id']}`"
    )

    # Wake up workers
    if _worker_event:
        _worker_event.set()


async def retry_transfer(chat_id: int, message_id: int):
    """Retries a transfer by re-fetching and re-queuing."""
    if not app.is_initialized:
        raise Exception("Telegram bot is not running.")
    
    # Try with bot first, fallback to userbot for peer resolution
    msg = None
    try:
        msg = await app.get_messages(chat_id, message_id)
    except (ValueError, KeyError, Exception):
        if userbot and userbot.is_initialized:
            try:
                msg = await userbot.get_messages(chat_id, message_id)
            except Exception:
                pass

    if not msg or getattr(msg, 'empty', True):
        raise Exception("Message not found or peer resolution failed.")
        
    if msg.document:
        await handle_file(app, msg, msg.document)
    elif msg.video:
        await handle_file(app, msg, msg.video)
    else:
        raise Exception("Message has no document or video.")

async def handle_document(client, message):
    await handle_file(client, message, message.document)

async def handle_video(client, message):
    await handle_file(client, message, message.video)

async def handle_audio(client, message):
    await handle_file(client, message, message.audio)

async def handle_photo(client, message):
    photo = message.photo
    file_info = type('obj', (object,), {
        'file_name': f"photo_{message.id}.jpg",
        'file_size': photo.file_size if photo else 0
    })()
    await handle_file(client, message, file_info)


# ═══════════════════════════════════════════════════════════════════
#  CHANNEL SEARCH & PULL — Discover content from source channels
# ═══════════════════════════════════════════════════════════════════

def _parse_quality(filename):
    fn = filename.upper()
    qualities = ["2160P", "4K", "1080P", "720P", "480P", "360P"]
    for q in qualities:
        if q in fn:
            return q.replace("P", "p")
    return "unknown"

def _parse_episode_info(filename):
    m = re.search(r'S(\d{1,2})E(\d{1,3})', filename, re.IGNORECASE)
    if m:
        return {"season": int(m.group(1)), "episode": int(m.group(2))}
    m = re.search(r'Season\s*(\d{1,2}).*?Episode\s*(\d{1,3})', filename, re.IGNORECASE)
    if m:
        return {"season": int(m.group(1)), "episode": int(m.group(2))}
    return None

# [L1] Removed duplicate _human_file_size — use shared _human_size from transfer_manager instead
_human_file_size = _human_size


async def search_source_channels(query, channel_list):
    """Search Telegram source channels for files matching a query.
    Uses userbot (if available) for searching public channels."""
    search_client = userbot if (userbot and userbot.is_initialized) else app
    if not search_client or not search_client.is_initialized:
        raise Exception("No Telegram client available for searching")

    client_type = "userbot" if search_client == userbot else "bot"
    print(f"Channel search using: {client_type} client")

    all_results = []

    for channel in channel_list:
        try:
            chat_id = channel
            if not channel.startswith("-100") and not channel.lstrip("-").isdigit():
                chat_id = channel.lstrip("@")

            async for msg in search_client.search_messages(chat_id, query=query, limit=50):
                file_info = None
                file_name = ""
                file_size = 0

                if msg.document:
                    file_info = msg.document
                    file_name = getattr(file_info, "file_name", "") or ""
                    file_size = getattr(file_info, "file_size", 0)
                elif msg.video:
                    file_info = msg.video
                    file_name = getattr(file_info, "file_name", "") or f"video_{msg.id}.mp4"
                    file_size = getattr(file_info, "file_size", 0)
                elif msg.audio:
                    file_info = msg.audio
                    file_name = getattr(file_info, "file_name", "") or ""
                    file_size = getattr(file_info, "file_size", 0)

                if not file_info or not file_name:
                    continue
                if file_size and file_size < 5_000_000:
                    continue

                quality = _parse_quality(file_name)
                ep_info = _parse_episode_info(file_name)
                mime = getattr(file_info, "mime_type", "") or ""

                result = {
                    "chat_id": msg.chat.id,
                    "message_id": msg.id,
                    "file_name": file_name,
                    "file_size": file_size,
                    "file_size_human": _human_file_size(file_size),
                    "quality": quality,
                    "episode_info": ep_info,
                    "mime_type": mime,
                    "channel": channel,
                    "date": msg.date.strftime("%Y-%m-%d") if msg.date else "",
                    "caption": (msg.caption or "")[:200],
                }
                all_results.append(result)

        except Exception as e:
            print(f"Channel search error ({channel}): {e}")
            continue

    all_results.sort(key=lambda x: x.get("file_size", 0), reverse=True)
    return all_results


async def search_global_files(query, limit=50):
    """V2: Search ALL public Telegram for files using search_global.
    Requires the userbot (user session) — bots cannot use search_global."""
    if not userbot or not userbot.is_initialized:
        raise Exception("Userbot not initialized — required for global search")

    print(f"🌐 Global search: '{query}' (limit={limit})")
    all_results = []

    try:
        async for msg in userbot.search_global(query, limit=limit):
            file_info = None
            file_name = ""
            file_size = 0

            if msg.document:
                file_info = msg.document
                file_name = getattr(file_info, "file_name", "") or ""
                file_size = getattr(file_info, "file_size", 0)
            elif msg.video:
                file_info = msg.video
                file_name = getattr(file_info, "file_name", "") or f"video_{msg.id}.mp4"
                file_size = getattr(file_info, "file_size", 0)
            elif msg.audio:
                file_info = msg.audio
                file_name = getattr(file_info, "file_name", "") or ""
                file_size = getattr(file_info, "file_size", 0)

            if not file_info or not file_name:
                continue
            # Skip tiny files (< 5MB — likely not media)
            if file_size and file_size < 5_000_000:
                continue

            quality = _parse_quality(file_name)
            ep_info = _parse_episode_info(file_name)
            mime = getattr(file_info, "mime_type", "") or ""

            # Get channel info
            chat_title = ""
            chat_username = ""
            try:
                if msg.chat:
                    chat_title = getattr(msg.chat, "title", "") or ""
                    chat_username = getattr(msg.chat, "username", "") or ""
            except Exception:
                pass

            result = {
                "chat_id": msg.chat.id if msg.chat else 0,
                "message_id": msg.id,
                "file_name": file_name,
                "file_size": file_size,
                "file_size_human": _human_file_size(file_size),
                "quality": quality,
                "episode_info": ep_info,
                "mime_type": mime,
                "channel": chat_username or str(msg.chat.id if msg.chat else "unknown"),
                "channel_title": chat_title,
                "date": msg.date.strftime("%Y-%m-%d") if msg.date else "",
                "caption": (msg.caption or "")[:200],
            }
            all_results.append(result)

    except Exception as e:
        print(f"Global search error: {e}")

    all_results.sort(key=lambda x: x.get("file_size", 0), reverse=True)
    print(f"🌐 Global search found {len(all_results)} results for '{query}'")
    return all_results

async def pull_from_channel(chat_id: int, message_id: int, override_name: str = ""):
    """Pull a file from a source channel into the persistent queue."""
    if not app or not app.is_initialized:
        raise Exception("Bot not running")

    # Direct fetch: try bot first, fallback to userbot
    msg = None
    try:
        msg = await app.get_messages(chat_id, message_id)
        if getattr(msg, 'empty', True):
            msg = None
    except Exception:
        pass

    if not msg and userbot and userbot.is_initialized:
        try:
            msg = await userbot.get_messages(chat_id, message_id)
            if getattr(msg, 'empty', True):
                msg = None
        except Exception:
            pass

    if not msg:
        raise Exception("Message not found or not accessible by bot/userbot")

    file_info = None
    if getattr(msg, 'document', None):
        file_info = msg.document
    elif getattr(msg, 'video', None):
        file_info = msg.video
    elif getattr(msg, 'audio', None):
        file_info = msg.audio
    else:
        raise Exception("Message has no file attachment")

    file_name = override_name or getattr(file_info, "file_name", None) or f"pull_{message_id}.mp4"
    file_size = getattr(file_info, "file_size", 0)

    # Classify the media
    parsed = MediaClassifier.parse(file_name)
    raw_title = parsed["title"] or "Unknown"
    media_type = parsed["type"]
    
    # TMDB auto-rename: fetch official title for accuracy
    tmdb_type = "tv" if media_type in ["show", "anime"] else "movie"
    try:
        import metadata_fetcher
        meta = metadata_fetcher.get_metadata(raw_title, year=str(parsed.get('year', '')), media_type=tmdb_type)
        clean_name = meta.get("tmdb_title") or raw_title
    except Exception:
        clean_name = raw_title
    
    if parsed.get("year"):
        clean_name += f" ({parsed['year']})"
    if parsed.get("season"):
        clean_name += f" S{parsed['season']:02d}E{parsed['episode']:02d}"
    elif parsed.get("episode"):
        clean_name += f" Ep.{parsed['episode']}"
    if parsed.get("quality"):
        clean_name += f" [{parsed['quality']}]"
    ext = os.path.splitext(file_name)[1] or ".mkv"
    clean_name += ext
        
    gdrive_hierarchy = MediaClassifier.generate_gdrive_path(parsed, include_season=True)

    # Add to persistent queue (survives restarts!)
    job = pq.add_job(
        chat_id=chat_id,
        message_id=message_id,
        file_name=file_name,
        file_size=file_size,
        source_channel=f"channel:{chat_id}",
        clean_name=clean_name,
        media_type=media_type
    )
    pq.update_job(job["id"], gdrive_hierarchy=gdrive_hierarchy)

    # Wake up workers
    if _worker_event:
        _worker_event.set()

    return {
        "job_id": job["id"],
        "file_name": file_name,
        "file_size": file_size,
        "pending": pq.pending_count()
    }


# ═══════════════════════════════════════════════════════════════════
#  TELEGRAM COMMANDS
# ═══════════════════════════════════════════════════════════════════

async def start_command(client, message):
    stats = tm.get_stats()
    q_stats = pq.get_stats()
    await message.reply_text(
        "🌟 **ATMOS GDrive Forwarder** 🌟\n\n"
        "Ultra Pro Max Pipeline v2.0\n\n"
        f"📊 **Stats:**\n"
        f"  Files: {stats['total_files']} | Data: {stats['total_size_human']}\n"
        f"  Uptime: {stats['uptime']}\n"
        f"  Active Workers: {q_stats['active']} | Pending: {q_stats['queued']}"
    )

async def help_command(client, message):
    await message.reply_text(
        "📖 **Help — ATMOS Forwarder**\n\n"
        "**How to use:**\n"
        "1. Forward any file/video/audio to this chat\n"
        "2. Bot downloads + uploads to Google Drive\n"
        "3. 4 concurrent workers process files simultaneously\n\n"
        "**Commands:**\n"
        "  /status — Active transfers\n"
        "  /queue — Queue overview\n"
        "  /storage — Google Drive space\n"
    )

async def status_command(client, message):
    q_stats = pq.get_stats()
    all_jobs = pq.get_all()
    
    lines = [f"📊 **Pipeline Status**\n"]
    lines.append(f"⚡ Active: {q_stats['active']} | 📋 Queued: {q_stats['queued']}")
    lines.append(f"✅ Done: {q_stats['completed']} | ❌ Failed: {q_stats['failed']}\n")

    for job in all_jobs.get("downloading", []) + all_jobs.get("uploading", []):
        lines.append(f"🔄 `{job['file_name'][:35]}` — {job['progress']}% ({job['phase'][:20]})")

    await message.reply_text("\n".join(lines) if len(lines) > 3 else "\n".join(lines) + "\n\nNo active transfers.")

async def queue_command(client, message):
    q_stats = pq.get_stats()
    all_jobs = pq.get_all()
    
    lines = [f"📋 **Queue Overview**\n"]
    lines.append(f"Pending: {q_stats['queued']} | Active: {q_stats['active']} | Done: {q_stats['completed']}")
    
    for job in all_jobs.get("queued", [])[:10]:
        size = _human_file_size(job.get('file_size', 0))
        lines.append(f"  ⏳ `{job['file_name'][:35]}` ({size})")

    await message.reply_text("\n".join(lines))

async def history_command(client, message):
    history = tm.get_history(10)
    if not history:
        await message.reply_text("📭 No transfer history yet.")
        return
    lines = ["**📋 Recent Transfers:**\n"]
    for t in history:
        icon = "✅" if t['status'] == 'completed' else "❌"
        size = _human_size(t['file_size']) if t['file_size'] else "—"
        lines.append(f"{icon} `{t['filename'][:35]}` — {size} ({t['duration'] or '—'})")
    await message.reply_text("\n".join(lines))

async def storage_command(client, message):
    if not GDRIVE_CREDENTIALS:
        await message.reply_text("❌ Google Drive not configured.")
        return
    try:
        info = gdrive_uploader.get_drive_storage_info(GDRIVE_CREDENTIALS)
        bar_filled = int(info['percent'] // 10) if info['percent'] else 0
        bar = "█" * bar_filled + "░" * (10 - bar_filled)
        await message.reply_text(
            f"💾 **Google Drive Storage**\n\n"
            f"[{bar}] {info['percent']}%\n"
            f"Used: {info['used_human']} / {info['total_human']}"
        )
    except Exception as e:
        await message.reply_text(f"❌ Failed to fetch storage: {str(e)[:200]}")


# ═══════════════════════════════════════════════════════════════════
#  BOT STARTUP
# ═══════════════════════════════════════════════════════════════════

async def run_bot_async():
    """Asynchronous entry point with FloodWait handling and concurrent workers."""
    global app, _stagger_lock, _worker_event
    if not (API_ID and API_HASH and BOT_TOKEN):
        print("Telegram credentials missing. Bot will not start.")
        return

    _stagger_lock = asyncio.Lock()
    _worker_event = asyncio.Event()

    try:
        if BOT_SESSION:
            print("ℹ️ Using BOT_SESSION for persistent login...")
            app = Client(
                "gdrive_forwarder_bot",
                api_id=int(API_ID),
                api_hash=API_HASH,
                session_string=BOT_SESSION,
                in_memory=True,
                max_concurrent_transmissions=8  # V2: Maximize download throughput
            )
        else:
            print("ℹ️ No BOT_SESSION — using BOT_TOKEN (initial login)...")
            app = Client(
                "gdrive_forwarder_bot",
                api_id=int(API_ID),
                api_hash=API_HASH,
                bot_token=BOT_TOKEN,
                in_memory=True,
                max_concurrent_transmissions=8  # V2: Maximize download throughput
            )
    except Exception as e:
        print(f"Failed to initialize Pyrogram: {e}")
        return

    # Register handlers
    app.add_handler(MessageHandler(handle_document, filters.document & is_owner))
    app.add_handler(MessageHandler(handle_video, filters.video & is_owner))
    app.add_handler(MessageHandler(handle_audio, filters.audio & is_owner))
    app.add_handler(MessageHandler(handle_photo, filters.photo & is_owner))
    app.add_handler(MessageHandler(start_command, filters.command("start") & is_owner))
    app.add_handler(MessageHandler(help_command, filters.command("help") & is_owner))
    app.add_handler(MessageHandler(status_command, filters.command("status") & is_owner))
    app.add_handler(MessageHandler(queue_command, filters.command("queue") & is_owner))
    app.add_handler(MessageHandler(history_command, filters.command("history") & is_owner))
    app.add_handler(MessageHandler(storage_command, filters.command("storage") & is_owner))

    print("Starting Telegram Bot...")
    try:
        await app.start()
    except Exception as e:
        err_str = str(e)
        if "FLOOD_WAIT" in err_str or "wait of" in err_str.lower():
            match = re.search(r'(\d+)\s*seconds', err_str)
            wait_secs = int(match.group(1)) if match else 300
            print(f"⏳ Telegram FloodWait: sleeping {wait_secs}s before retrying...")
            await asyncio.sleep(wait_secs + 5)
            await app.start()
        else:
            raise
    print("✅ Telegram Bot Started Successfully!")

    # Start userbot for channel searching
    global userbot
    if USERBOT_SESSION and API_ID and API_HASH:
        try:
            userbot = Client(
                "atmos_userbot",
                api_id=int(API_ID),
                api_hash=API_HASH,
                session_string=USERBOT_SESSION,
                in_memory=True,
                max_concurrent_transmissions=8  # V2: Maximize download throughput
            )
            await userbot.start()
            me = await userbot.get_me()
            print(f"✅ Userbot started: @{me.username or me.first_name} (channel search enabled)")
        except Exception as e:
            print(f"⚠️ Userbot failed to start: {e}")
            userbot = None
    else:
        print("ℹ️ No USERBOT_SESSION — channel search will use bot client")

    # ── Recover interrupted jobs from previous run ──
    recovered = pq.recover_interrupted()
    if recovered:
        _worker_event.set()  # Wake workers to process recovered jobs

    # ── Launch concurrent pipeline workers ──
    print(f"🚀 Launching {CONCURRENT_WORKERS} concurrent pipeline workers...")
    for i in range(CONCURRENT_WORKERS):
        asyncio.create_task(pipeline_worker(i))

    # We do NOT sleep forever here anymore, because this is now part of the main FastAPI loop
    print("✅ Bot tasks initialized and background workers started.")


def run_bot():
    """Legacy entry point — now handled via FastAPI lifespan."""
    print("⚠️ Legacy run_bot() called. Switching to FastAPI lifespan.")

if __name__ == "__main__":
    run_bot()
