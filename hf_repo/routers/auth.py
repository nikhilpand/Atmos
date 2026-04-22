"""Auth Router — /api/admin/login"""

import hmac
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from utils.auth import ADMIN_PASSWORD, _create_admin_token

router = APIRouter()


@router.post("/api/admin/login")
async def admin_login(request: Request):
    """Login with password, returns HMAC session token."""
    try:
        body = await request.json()
        pwd = body.get("password", "")
    except Exception:
        pwd = request.headers.get("x-admin-password", "")
    if ADMIN_PASSWORD and hmac.compare_digest(pwd, ADMIN_PASSWORD):
        token = _create_admin_token()
        return JSONResponse({"token": token, "expires_in": 86400})
    return JSONResponse({"error": "Invalid password"}, status_code=401)
