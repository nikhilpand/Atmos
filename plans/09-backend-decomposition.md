# 09 — Backend: hf_repo/app.py God-Module Decomposition Plan

## Reality Check (What the Graph Said vs Actual)

| Claim | Actual Finding |
|-------|---------------|
| "auth always returns True" | ❌ FALSE — `check_admin_auth()` at line 200 is fully implemented with HMAC tokens, rate limiting, and brute-force lockout |
| "73 functions, monolith" | ✅ TRUE — 128 defs/routes, 2280 lines, 95KB |
| "security time bomb" | ⚠️ PARTIAL — auth is real, BUT `ADMIN_PASSWORD = "1908"` is hardcoded at line 137 (not from env) |
| "_human_size 3x" | ✅ TRUE — confirmed in transfer_manager.py:177, smart_search.py:637, multi_source.py:86 |

---

## 🔴 CRITICAL: ADMIN_PASSWORD Hardcoded in app.py

**File:** `hf_repo/app.py` — line 137

```python
# ❌ BEFORE
ADMIN_PASSWORD = "1908"  # hardcoded, committed to git
```

```python
# ✅ AFTER
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD")
if not ADMIN_PASSWORD:
    raise RuntimeError("ADMIN_PASSWORD environment variable is required")
```

**Immediate action:** Set the secret in Hugging Face Space secrets UI, never in code.

---

## Router Extraction Plan (53 admin routes → 5 router files)

The 2280-line `app.py` should be split into FastAPI APIRouter modules:

```
hf_repo/
  app.py                  ← lifespan, middleware, router includes only (~100 lines)
  routers/
    __init__.py
    auth.py               ← /api/admin/login, check_admin_auth, token logic
    files.py              ← /api/files, /api/videos, /api/stream, /api/tracks, /api/subtitle
    admin_drive.py        ← /api/admin/rename, delete, auto-rename, undo-rename, drive/browse, drive/mkdir, drive/move, bulk/rename, bulk/delete, share-all
    admin_queue.py        ← /api/admin/queue, queue/retry, queue/clear, pull, pull-batch, clear_queue
    admin_system.py       ← /api/admin/system, config, logs, restart, retry, health, analytics/reset, bot-info, telegram/send
    admin_content.py      ← /api/admin/tmdb-search, tmdb/trending, channel-search, channel-search-global, source-channels, schedules, history, activity, reorganize
    discover.py           ← /api/discover/search, forward, auto-forward, torrent-search
    websocket.py          ← /ws/admin
  utils/
    __init__.py
    human_size.py         ← Single _human_size() — imported by all 3 files
    auth.py               ← check_admin_auth, _create_admin_token, _verify_admin_token
```

### Target `app.py` (after refactor) — ~80 lines:

```python
# app.py — Lifespan + Middleware + Router Registration ONLY
from fastapi import FastAPI
from contextlib import asynccontextmanager
import telegram_bot, asyncio
from routers import auth, files, admin_drive, admin_queue, admin_system, admin_content, discover, websocket

@asynccontextmanager
async def lifespan(app: FastAPI):
    asyncio.create_task(telegram_bot.run_bot_async())
    yield

app = FastAPI(lifespan=lifespan)

# Middleware
app.add_middleware(CORSMiddleware, ...)
app.add_middleware(RateLimitMiddleware)

# Routers
app.include_router(auth.router, tags=["auth"])
app.include_router(files.router, tags=["files"])
app.include_router(admin_drive.router, prefix="/api/admin", tags=["admin:drive"])
app.include_router(admin_queue.router, prefix="/api/admin", tags=["admin:queue"])
app.include_router(admin_system.router, prefix="/api/admin", tags=["admin:system"])
app.include_router(admin_content.router, prefix="/api/admin", tags=["admin:content"])
app.include_router(discover.router, prefix="/api", tags=["discover"])
app.include_router(websocket.router, tags=["ws"])
```

---

## Auth Router (`routers/auth.py`)

```python
from fastapi import APIRouter, Request, Depends
from fastapi.responses import JSONResponse
from utils.auth import check_admin_auth, _create_admin_token
import hmac, os

router = APIRouter()
ADMIN_PASSWORD = os.environ["ADMIN_PASSWORD"]

@router.post("/api/admin/login")
async def admin_login(request: Request):
    try:
        body = await request.json()
        pwd = body.get("password", "")
    except Exception:
        pwd = request.headers.get("x-admin-password", "")
    if hmac.compare_digest(pwd, ADMIN_PASSWORD):
        return JSONResponse({"token": _create_admin_token(), "expires_in": 86400})
    return JSONResponse({"error": "Invalid password"}, status_code=401)
```

---

## DRY Fix: `utils/human_size.py`

```python
# hf_repo/utils/human_size.py
def human_size(num_bytes: int) -> str:
    """Convert bytes to human-readable string. Single canonical implementation."""
    for unit in ('B', 'KB', 'MB', 'GB', 'TB'):
        if abs(num_bytes) < 1024.0:
            return f"{num_bytes:.1f} {unit}"
        num_bytes /= 1024.0
    return f"{num_bytes:.1f} PB"
```

Then in each file:
```python
# ❌ BEFORE — local def
def _human_size(b): ...

# ✅ AFTER — shared import
from utils.human_size import human_size as _human_size  # alias for zero diff
```

---

## Router Dependency Injection for Auth

Instead of calling `check_admin_auth(request)` in every route (40 call sites), use FastAPI dependencies:

```python
# utils/auth.py
from fastapi import Depends, HTTPException, Request

def require_admin(request: Request):
    """FastAPI dependency — raises 401 if not authenticated."""
    if not check_admin_auth(request):
        raise HTTPException(status_code=401, detail="Unauthorized")

# routers/admin_drive.py
from utils.auth import require_admin
from fastapi import Depends

@router.post("/rename/{file_id}", dependencies=[Depends(require_admin)])
async def api_admin_rename(file_id: str, request: Request):
    # No auth check needed here — dependency handles it
    ...
```

This eliminates the 40 repetitive `if not check_admin_auth(request): return JSONResponse(...)` blocks.

---

## Checklist
- [ ] Move `ADMIN_PASSWORD = "1908"` to env var — set in HF Space secrets
- [ ] Create `hf_repo/utils/human_size.py` with single `human_size()` function
- [ ] Update `transfer_manager.py`, `smart_search.py`, `multi_source.py` to import from utils
- [ ] Create `hf_repo/routers/` package
- [ ] Extract `auth.py` router with token logic
- [ ] Extract `files.py` router (stream, videos, tracks, subtitle)
- [ ] Extract `admin_drive.py` router (rename, delete, browse, move)
- [ ] Extract `admin_queue.py` router (queue management, pull, schedules)
- [ ] Extract `admin_system.py` router (system, logs, config, analytics)
- [ ] Extract `admin_content.py` router (TMDB, channels, history)
- [ ] Extract `discover.py` router
- [ ] Extract `websocket.py` router
- [ ] Replace 40x `check_admin_auth(request)` calls with `Depends(require_admin)`
- [ ] Slim `app.py` to ~80 lines (middleware + router registration only)
- [ ] Run `python -m pytest hf_repo/` to verify no import regressions
