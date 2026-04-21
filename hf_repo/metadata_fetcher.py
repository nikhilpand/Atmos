import os
import sqlite3
import requests
import json
import urllib.parse
from datetime import datetime

TMDB_API_KEY = os.environ.get("TMDB_API_KEY", "")
CACHE_DB_PATH = "metadata_cache.db"

# [CR2-H4] Module-level connection to avoid per-call open/close overhead
import threading
_db_lock = threading.Lock()

def _get_db():
    """Returns a module-level SQLite connection (lazy-init, thread-safe via _db_lock)."""
    if not hasattr(_get_db, '_conn') or _get_db._conn is None:
        _get_db._conn = sqlite3.connect(CACHE_DB_PATH, check_same_thread=False)
        _get_db._conn.execute('''
            CREATE TABLE IF NOT EXISTS metadata (
                title TEXT,
                year TEXT,
                media_type TEXT,
                data TEXT,
                fetched_at TIMESTAMP,
                PRIMARY KEY (title, year)
            )
        ''')
        _get_db._conn.commit()
    return _get_db._conn

def get_metadata(title, year="", media_type="multi"):
    """
    Returns rich metadata for a title from TMDB.
    Returns: dict with poster_url, backdrop_url, synopsis, rating, title, release_date
    """
    if not title:
        return {}

    # Check cache (thread-safe via _db_lock)
    with _db_lock:
        conn = _get_db()
        c = conn.cursor()
        c.execute('SELECT data FROM metadata WHERE title=? AND year=?', (title.lower(), year))
        row = c.fetchone()

    if row:
        return json.loads(row[0])

    if not TMDB_API_KEY:
        return {}

    # [CR2-C1] Whitelist media_type
    if media_type not in ("multi", "movie", "tv"):
        media_type = "multi"

    try:
        url = f"https://api.themoviedb.org/3/search/{media_type}"
        params = {"api_key": TMDB_API_KEY, "query": title}
        if year:
            if media_type == "movie":
                params["year"] = year
            elif media_type == "tv":
                params["first_air_date_year"] = year
            
        r = requests.get(url, params=params, timeout=10)
        if r.status_code == 200:
            data = r.json()
            results = data.get("results", [])
            if results:
                # Find the best match (prioritize movies/tv over persons)
                result = None
                if media_type == "multi":
                    for res in results:
                        if res.get("media_type") in ["movie", "tv"]:
                            result = res
                            break
                
                # Fallback to first result if no specific type match or not multi
                if not result:
                    result = results[0]
                
                poster_path = result.get('poster_path')
                backdrop_path = result.get('backdrop_path')
                
                poster = f"https://image.tmdb.org/t/p/w500{poster_path}" if poster_path else ""
                backdrop = f"https://image.tmdb.org/t/p/w1280{backdrop_path}" if backdrop_path else ""
                
                meta = {
                    "poster_url": poster,
                    "backdrop_url": backdrop,
                    "synopsis": result.get("overview", ""),
                    "rating": result.get("vote_average", 0),
                    "tmdb_title": result.get("title") or result.get("name") or title,
                    "release_date": result.get("release_date") or result.get("first_air_date") or "",
                    "tmdb_id": result.get("id"),
                    "media_type": result.get("media_type", media_type)
                }

                # Save to cache
                with _db_lock:
                    conn = _get_db()
                    c = conn.cursor()
                    c.execute(
                        'REPLACE INTO metadata (title, year, media_type, data, fetched_at) VALUES (?, ?, ?, ?, ?)',
                        (title.lower(), year, media_type, json.dumps(meta), datetime.now())
                    )
                    conn.commit()

                return meta
                
        # Cache empty to prevent constant re-fetching of failed queries
        with _db_lock:
            conn = _get_db()
            c = conn.cursor()
            c.execute(
                'REPLACE INTO metadata (title, year, media_type, data, fetched_at) VALUES (?, ?, ?, ?, ?)',
                (title.lower(), year, media_type, json.dumps({}), datetime.now())
            )
            conn.commit()
        
        return {}

    except Exception as e:
        print(f"TMDB Fetch error: {e}")
        return {}
