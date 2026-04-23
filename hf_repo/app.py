"""
ATMOS V2.0 — app.py
Lifespan + Middleware + Router Registration ONLY.
All route logic lives in routers/*.py, shared utilities in utils/*.py.
"""

import sys
import asyncio
import time
from collections import deque, OrderedDict
from contextlib import asynccontextmanager

# Load dev phase secrets
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ─── Log Queue (intercepting stdout/stderr) ─────────────────────
log_queue = deque(maxlen=500)


class QueueLogger:
    def write(self, msg):
        if not msg.strip():
            return
        if any(x in msg for x in ["GET /api/admin/logs", "GET /api/admin/system",
                                    "GET /api/videos", "GET /api/admin/bot-info"]):
            return
        log_queue.append(msg.strip())
        sys.__stdout__.write(msg)

    def flush(self):
        sys.__stdout__.flush()

    def isatty(self):
        return False


sys.stdout = QueueLogger()
sys.stderr = QueueLogger()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse as StarletteJSON

import telegram_bot
from routers import auth, files, admin_drive, admin_queue, admin_system, admin_content, discover, websocket

# Share log_queue with admin_system router
admin_system.log_queue = log_queue


# ─── Lifespan ────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    print("🚀 Unified Startup: Booting Telegram Bot...")
    asyncio.create_task(telegram_bot.run_bot_async())
    yield
    print("🛑 Unified Shutdown: Stopping resources...")


# ─── FastAPI App ─────────────────────────────────────────────────
fastapi_app = FastAPI(lifespan=lifespan)

# ─── CORS ────────────────────────────────────────────────────────
ALLOWED_ORIGINS = [
    "https://atmos.page.gd",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "https://atmos-coral-sigma.vercel.app",
]
fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Range", "Accept-Ranges", "Content-Length"],
)

# ─── Rate Limiter ────────────────────────────────────────────────
_rate_buckets = OrderedDict()
_RATE_MAX_TOKENS = 30
_RATE_REFILL_RATE = 10
_RATE_BUCKET_MAX = 5000


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        ip = request.client.host if request.client else "0.0.0.0"
        if request.url.path in ("/health", "/", "/api/admin/login"):
            return await call_next(request)
        now = time.time()
        if ip not in _rate_buckets:
            _rate_buckets[ip] = {"tokens": _RATE_MAX_TOKENS, "last": now}
        bucket = _rate_buckets[ip]
        elapsed = now - bucket["last"]
        bucket["tokens"] = min(_RATE_MAX_TOKENS, bucket["tokens"] + elapsed * _RATE_REFILL_RATE)
        bucket["last"] = now
        if bucket["tokens"] < 1:
            return StarletteJSON({"error": "Rate limit exceeded"}, status_code=429)
        bucket["tokens"] -= 1
        _rate_buckets.move_to_end(ip)
        while len(_rate_buckets) > _RATE_BUCKET_MAX:
            _rate_buckets.popitem(last=False)
        return await call_next(request)


fastapi_app.add_middleware(RateLimitMiddleware)

# ─── Mount Downloader ────────────────────────────────────────────
try:
    from downloader_server import app as downloader_app
    fastapi_app.mount("/downloader", downloader_app)
    print("✅ Downloader API mounted at /downloader")
except Exception as e:
    print(f"⚠️ Failed to mount downloader API: {e}")

# ─── Register Routers ───────────────────────────────────────────
fastapi_app.include_router(auth.router, tags=["auth"])
fastapi_app.include_router(files.router, tags=["files"])
fastapi_app.include_router(admin_drive.router, prefix="/api/admin", tags=["admin:drive"])
fastapi_app.include_router(admin_queue.router, prefix="/api/admin", tags=["admin:queue"])
fastapi_app.include_router(admin_system.router, prefix="/api/admin", tags=["admin:system"])
fastapi_app.include_router(admin_content.router, prefix="/api/admin", tags=["admin:content"])
fastapi_app.include_router(discover.router, prefix="/api", tags=["discover"])
fastapi_app.include_router(websocket.router, tags=["ws"])


# ─── Root Redirects ──────────────────────────────────────────────
@fastapi_app.get("/")
async def root():
    return RedirectResponse("http://atmos.page.gd")


@fastapi_app.get("/admin")
async def admin_redirect():
    return RedirectResponse("http://atmos.page.gd/admin.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(fastapi_app, host="0.0.0.0", port=7860)
