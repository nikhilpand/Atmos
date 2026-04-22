"""ATMOS Auth Utilities — HMAC token creation, verification, and admin dependency."""

import os
import hmac
import hashlib
import json
import time
import base64
from collections import OrderedDict
from fastapi import Request, HTTPException

ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD")
if not ADMIN_PASSWORD:
    import warnings
    warnings.warn("ADMIN_PASSWORD env var not set — admin auth will reject all requests")
    ADMIN_PASSWORD = ""

# Bounded rate limiter for auth failures (LRU eviction)
_AUTH_MAX_ENTRIES = 10000
_auth_failures: OrderedDict = OrderedDict()
_AUTH_MAX_FAILURES = 10
_AUTH_LOCKOUT_SECONDS = 300


def _create_admin_token(ttl: int = 86400) -> str:
    """Create HMAC-signed admin session token with expiry."""
    payload = json.dumps({"exp": int(time.time()) + ttl, "role": "admin"})
    sig = hmac.new(ADMIN_PASSWORD.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return base64.b64encode(f"{payload}:{sig}".encode()).decode()


def _verify_admin_token(token: str) -> bool:
    """Verify HMAC-signed admin token."""
    try:
        decoded = base64.b64decode(token).decode()
        payload, sig = decoded.rsplit(":", 1)
        expected = hmac.new(ADMIN_PASSWORD.encode(), payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return False
        data = json.loads(payload)
        return data.get("exp", 0) > time.time()
    except Exception:
        return False


def check_admin_auth(request: Request) -> bool:
    """Validate admin auth via HMAC token or password header."""
    ip = request.client.host if request.client else "unknown"

    # Rate limit check
    if ip in _auth_failures:
        count, last_time = _auth_failures[ip]
        if count >= _AUTH_MAX_FAILURES and (time.time() - last_time) < _AUTH_LOCKOUT_SECONDS:
            return False

    # Check Bearer token first (HMAC session)
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        if _verify_admin_token(token):
            return True

    # Fallback: password header (for backwards compat)
    pwd = request.headers.get("x-admin-password", "")
    if pwd and hmac.compare_digest(pwd, ADMIN_PASSWORD):
        return True

    # Track failure
    if ip in _auth_failures:
        count, _ = _auth_failures[ip]
        _auth_failures[ip] = (count + 1, time.time())
    else:
        _auth_failures[ip] = (1, time.time())
    while len(_auth_failures) > _AUTH_MAX_ENTRIES:
        _auth_failures.popitem(last=False)
    return False


def require_admin(request: Request):
    """FastAPI dependency — raises 401 if not authenticated."""
    if not check_admin_auth(request):
        raise HTTPException(status_code=401, detail="Unauthorized")
