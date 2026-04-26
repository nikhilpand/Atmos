"""Auth Router — /api/admin/login with brute-force rate limiting"""

import hmac
import time
from collections import defaultdict
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from utils.auth import ADMIN_PASSWORD, _create_admin_token

router = APIRouter()

# ─── Login Rate Limiter (5 attempts per 15 minutes per IP) ───────
_login_attempts: dict[str, list[float]] = defaultdict(list)
_LOGIN_MAX_ATTEMPTS = 5
_LOGIN_WINDOW = 900  # 15 minutes


def _is_login_rate_limited(ip: str) -> bool:
    now = time.time()
    # Prune old attempts
    _login_attempts[ip] = [t for t in _login_attempts[ip] if now - t < _LOGIN_WINDOW]
    return len(_login_attempts[ip]) >= _LOGIN_MAX_ATTEMPTS


@router.post("/api/admin/login")
async def admin_login(request: Request):
    """Login with password, returns HMAC session token.
    Rate limited to 5 attempts per 15 minutes per IP."""
    ip = request.client.host if request.client else "0.0.0.0"

    if _is_login_rate_limited(ip):
        return JSONResponse(
            {"error": "Too many login attempts. Try again later."},
            status_code=429
        )

    try:
        body = await request.json()
        pwd = body.get("password", "")
    except Exception:
        pwd = request.headers.get("x-admin-password", "")

    _login_attempts[ip].append(time.time())

    if ADMIN_PASSWORD and hmac.compare_digest(pwd, ADMIN_PASSWORD):
        # Clear attempts on success
        _login_attempts[ip] = []
        token = _create_admin_token()
        return JSONResponse({"token": token, "expires_in": 86400})

    return JSONResponse({"error": "Invalid password"}, status_code=401)
