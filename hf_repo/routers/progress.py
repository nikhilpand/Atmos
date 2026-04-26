"""Watch Progress Router — /api/progress
Stores and retrieves watch position for Continue Watching and resume.
Uses SQLite for zero-dependency persistence on HF Spaces.
"""

import os
import time
import sqlite3
import threading
from contextlib import contextmanager
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter()

DB_PATH = os.environ.get("PROGRESS_DB", "watch_progress.db")
_db_lock = threading.Lock()


def _init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS progress (
                key TEXT PRIMARY KEY,
                tmdb_id TEXT NOT NULL,
                media_type TEXT NOT NULL,
                title TEXT,
                poster_path TEXT,
                backdrop_path TEXT,
                season INTEGER,
                episode INTEGER,
                progress REAL DEFAULT 0,
                current_time REAL DEFAULT 0,
                duration REAL DEFAULT 0,
                genre_ids TEXT DEFAULT '[]',
                completed INTEGER DEFAULT 0,
                updated_at REAL DEFAULT 0
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_progress_updated ON progress(updated_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_progress_tmdb ON progress(tmdb_id)")


_init_db()


@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def _make_key(tmdb_id: str, season=None, episode=None) -> str:
    if season is not None and episode is not None:
        return f"{tmdb_id}:{season}:{episode}"
    return tmdb_id


@router.post("/progress")
async def save_progress(request: Request):
    """Save watch progress for a title/episode."""
    try:
        data = await request.json()
        tmdb_id = data.get("tmdbId") or data.get("tmdb_id")
        if not tmdb_id:
            return JSONResponse({"error": "tmdb_id required"}, status_code=400)

        key = _make_key(
            tmdb_id,
            data.get("season"),
            data.get("episode")
        )

        progress = float(data.get("progress", 0))
        completed = 1 if progress >= 92 else 0

        with _db_lock, get_db() as conn:
            conn.execute("""
                INSERT OR REPLACE INTO progress
                (key, tmdb_id, media_type, title, poster_path, backdrop_path,
                 season, episode, progress, current_time, duration,
                 genre_ids, completed, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                key,
                str(tmdb_id),
                data.get("mediaType", data.get("media_type", "movie")),
                data.get("title", ""),
                data.get("posterPath", data.get("poster_path")),
                data.get("backdropPath", data.get("backdrop_path")),
                data.get("season"),
                data.get("episode"),
                progress,
                float(data.get("currentTime", data.get("current_time", 0))),
                float(data.get("duration", 0)),
                str(data.get("genreIds", data.get("genre_ids", "[]"))),
                completed,
                time.time(),
            ))

        return JSONResponse({"success": True, "key": key})
    except Exception as e:
        return JSONResponse({"error": str(e)[:300]}, status_code=500)


@router.get("/progress/{tmdb_id}")
async def get_progress(tmdb_id: str, season: int = None, episode: int = None):
    """Get progress for a specific title or episode."""
    key = _make_key(tmdb_id, season, episode)
    with get_db() as conn:
        row = conn.execute("SELECT * FROM progress WHERE key = ?", (key,)).fetchone()
        if not row:
            return JSONResponse({"found": False})
        return JSONResponse({
            "found": True,
            "data": dict(row),
        })


@router.get("/progress")
async def get_all_progress(limit: int = 50, completed: int = None):
    """Get all progress entries (for Continue Watching row)."""
    with get_db() as conn:
        if completed is not None:
            rows = conn.execute(
                "SELECT * FROM progress WHERE completed = ? ORDER BY updated_at DESC LIMIT ?",
                (completed, limit)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM progress ORDER BY updated_at DESC LIMIT ?",
                (limit,)
            ).fetchall()
        return JSONResponse({
            "entries": [dict(r) for r in rows],
            "total": len(rows),
        })


@router.delete("/progress/{key}")
async def delete_progress(key: str):
    """Remove a progress entry."""
    with _db_lock, get_db() as conn:
        conn.execute("DELETE FROM progress WHERE key = ?", (key,))
    return JSONResponse({"success": True})
