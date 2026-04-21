"""
ATMOS Multi-Source Search Provider V2.0
Aggregates results from multiple public indexing APIs alongside Telegram.
Each provider returns a unified result format compatible with smart_search.py.
"""

import re
import asyncio
import hashlib
import time
from collections import OrderedDict
from typing import List, Dict, Optional

try:
    import httpx
except ImportError:
    httpx = None

# ═══════════════════════════════════════════════════════════════════
#  RESULT CACHE — LRU cache to avoid hammering providers
# ═══════════════════════════════════════════════════════════════════

_cache = OrderedDict()
_CACHE_MAX = 500
_CACHE_TTL = 600  # 10 minutes

def _cache_key(provider: str, query: str) -> str:
    return hashlib.md5(f"{provider}:{query.lower().strip()}".encode()).hexdigest()

def _cache_get(key: str):
    if key in _cache:
        ts, data = _cache[key]
        if time.time() - ts < _CACHE_TTL:
            _cache.move_to_end(key)
            return data
        del _cache[key]
    return None

def _cache_set(key: str, data):
    _cache[key] = (time.time(), data)
    while len(_cache) > _CACHE_MAX:
        _cache.popitem(last=False)

# ═══════════════════════════════════════════════════════════════════
#  UNIFIED RESULT FORMAT
# ═══════════════════════════════════════════════════════════════════

def _make_result(
    file_name: str,
    file_size: int = 0,
    quality: str = "unknown",
    source_provider: str = "unknown",
    source_url: str = "",
    seeders: int = 0,
    leechers: int = 0,
    magnet: str = "",
    date: str = "",
    category: str = "",
    **extra
) -> Dict:
    """Build a unified result dict compatible with smart_search scoring."""
    return {
        "file_name": file_name,
        "file_size": file_size,
        "file_size_human": _human_size(file_size),
        "quality": quality or _extract_quality(file_name),
        "source_provider": source_provider,
        "source_url": source_url,
        "seeders": seeders,
        "leechers": leechers,
        "magnet": magnet,
        "date": date,
        "category": category,
        "chat_id": 0,         # No Telegram context
        "message_id": 0,
        "channel": source_provider,
        "channel_title": source_provider,
        "caption": "",
        **extra,
    }

def _extract_quality(name: str) -> str:
    m = re.search(r'(2160p|4K|1080p|720p|480p|360p)', name, re.I)
    return m.group(1) if m else "unknown"

def _human_size(b: int) -> str:
    if b <= 0: return "—"
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if b < 1024: return f"{b:.1f} {unit}"
        b /= 1024
    return f"{b:.1f} PB"

def _parse_size(s: str) -> int:
    """Parse size string like '1.5 GB' to bytes."""
    if not s:
        return 0
    s = s.strip().upper()
    m = re.match(r'([\d.]+)\s*(TB|GB|MB|KB|B)', s)
    if not m:
        return 0
    val = float(m.group(1))
    unit = m.group(2)
    mul = {'B': 1, 'KB': 1024, 'MB': 1024**2, 'GB': 1024**3, 'TB': 1024**4}
    return int(val * mul.get(unit, 1))


# ═══════════════════════════════════════════════════════════════════
#  PROVIDER: 1337x (via public API proxies)
# ═══════════════════════════════════════════════════════════════════

_1337X_MIRRORS = [
    "https://1337x.to",
    "https://1337x.st",
    "https://1337x.gd",
    "https://1337xx.to",
]

async def search_1337x(query: str, limit: int = 40) -> List[Dict]:
    """Search 1337x torrent index."""
    if not httpx:
        return []
    
    ck = _cache_key("1337x", query)
    cached = _cache_get(ck)
    if cached is not None:
        return cached

    results = []
    
    for mirror in _1337X_MIRRORS:
        try:
            async with httpx.AsyncClient(timeout=8, follow_redirects=True) as client:
                # Use the category-filtered search for movies/TV
                url = f"{mirror}/search/{query.replace(' ', '+')}/1/"
                resp = await client.get(url, headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                })
                if resp.status_code != 200:
                    continue
                
                html = resp.text
                # Parse table rows
                rows = re.findall(
                    r'<td class="coll-1 name">.*?<a href="(/torrent/[^"]+)"[^>]*>([^<]+)</a>.*?'
                    r'<td class="coll-date">([^<]*)</td>.*?'
                    r'<td class="coll-4 size[^"]*">([^<]*)<',
                    html, re.DOTALL
                )
                
                for path, name, date, size_str in rows[:limit]:
                    name = name.strip()
                    if not name:
                        continue
                    file_size = _parse_size(size_str.strip())
                    
                    # Extract seeders/leechers
                    seed_match = re.search(
                        re.escape(name) + r'.*?<td class="coll-2 seeds">(\d+)</td>\s*<td class="coll-3 leeches">(\d+)</td>',
                        html, re.DOTALL
                    )
                    seeders = int(seed_match.group(1)) if seed_match else 0
                    leechers = int(seed_match.group(2)) if seed_match else 0
                    
                    results.append(_make_result(
                        file_name=name,
                        file_size=file_size,
                        source_provider="1337x",
                        source_url=f"{mirror}{path}",
                        seeders=seeders,
                        leechers=leechers,
                        date=date.strip(),
                        category="torrent",
                    ))
                
                if results:
                    break  # Got results from this mirror
                    
        except Exception as e:
            print(f"1337x mirror {mirror} failed: {e}")
            continue

    _cache_set(ck, results)
    return results


# ═══════════════════════════════════════════════════════════════════
#  PROVIDER: TorrentGalaxy
# ═══════════════════════════════════════════════════════════════════

_TGX_MIRRORS = [
    "https://torrentgalaxy.to",
    "https://tgx.rs",
    "https://torrentgalaxy.mx",
]

async def search_torrentgalaxy(query: str, limit: int = 30) -> List[Dict]:
    """Search TorrentGalaxy."""
    if not httpx:
        return []
    
    ck = _cache_key("tgx", query)
    cached = _cache_get(ck)
    if cached is not None:
        return cached

    results = []
    
    for mirror in _TGX_MIRRORS:
        try:
            async with httpx.AsyncClient(timeout=8, follow_redirects=True) as client:
                url = f"{mirror}/torrents.php"
                resp = await client.get(url, params={
                    "search": query,
                    "sort": "seeders",
                    "order": "desc",
                }, headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                })
                if resp.status_code != 200:
                    continue
                
                html = resp.text
                # Parse torrent entries
                entries = re.findall(
                    r'<a href="(/torrent/\d+/[^"]+)"[^>]*title="([^"]+)"',
                    html
                )
                sizes = re.findall(r'<span class="badge badge-secondary txlight">\s*([^<]+)\s*</span>', html)
                seeds_leech = re.findall(
                    r'<font color="green"><b>(\d+)</b></font>.*?<font color="#ff0000"><b>(\d+)</b></font>',
                    html, re.DOTALL
                )
                
                for i, (path, name) in enumerate(entries[:limit]):
                    size_str = sizes[i] if i < len(sizes) else ""
                    s, l = (int(seeds_leech[i][0]), int(seeds_leech[i][1])) if i < len(seeds_leech) else (0, 0)
                    
                    results.append(_make_result(
                        file_name=name.strip(),
                        file_size=_parse_size(size_str),
                        source_provider="TorrentGalaxy",
                        source_url=f"{mirror}{path}",
                        seeders=s,
                        leechers=l,
                        category="torrent",
                    ))
                
                if results:
                    break
                    
        except Exception as e:
            print(f"TGX mirror {mirror} failed: {e}")
            continue

    _cache_set(ck, results)
    return results


# ═══════════════════════════════════════════════════════════════════
#  PROVIDER: PirateBay (via Apibay)
# ═══════════════════════════════════════════════════════════════════

_TPB_API = "https://apibay.org"

async def search_piratebay(query: str, limit: int = 30) -> List[Dict]:
    """Search The Pirate Bay via apibay.org API."""
    if not httpx:
        return []
    
    ck = _cache_key("tpb", query)
    cached = _cache_get(ck)
    if cached is not None:
        return cached

    results = []
    
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            # Category 200 = Video, 205 = TV, 201 = Movies
            resp = await client.get(f"{_TPB_API}/q.php", params={
                "q": query,
                "cat": "200,201,205,207,208",
            })
            if resp.status_code != 200:
                return []
            
            data = resp.json()
            if not data or (len(data) == 1 and data[0].get("name") == "No results returned"):
                return []
            
            for item in data[:limit]:
                name = item.get("name", "")
                if not name:
                    continue
                
                info_hash = item.get("info_hash", "")
                magnet = f"magnet:?xt=urn:btih:{info_hash}&dn={name}" if info_hash else ""
                
                results.append(_make_result(
                    file_name=name,
                    file_size=int(item.get("size", 0)),
                    source_provider="PirateBay",
                    source_url=f"https://thepiratebay.org/description.php?id={item.get('id', '')}",
                    seeders=int(item.get("seeders", 0)),
                    leechers=int(item.get("leechers", 0)),
                    magnet=magnet,
                    date=item.get("added", ""),
                    category="torrent",
                ))
    except Exception as e:
        print(f"PirateBay search error: {e}")

    _cache_set(ck, results)
    return results


# ═══════════════════════════════════════════════════════════════════
#  PROVIDER: YTS (YIFY Movies)
# ═══════════════════════════════════════════════════════════════════

_YTS_API = "https://yts.mx/api/v2"

async def search_yts(query: str, limit: int = 20) -> List[Dict]:
    """Search YTS for high-quality movie torrents."""
    if not httpx:
        return []
    
    ck = _cache_key("yts", query)
    cached = _cache_get(ck)
    if cached is not None:
        return cached

    results = []
    
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.get(f"{_YTS_API}/list_movies.json", params={
                "query_term": query,
                "limit": min(limit, 50),
                "sort_by": "seeds",
            })
            if resp.status_code != 200:
                return []
            
            data = resp.json()
            movies = data.get("data", {}).get("movies", [])
            
            for movie in movies:
                for torrent in movie.get("torrents", []):
                    name = f"{movie['title']} ({movie.get('year', '')}) [{torrent.get('quality', '')}] [{torrent.get('type', '')}]"
                    
                    results.append(_make_result(
                        file_name=name,
                        file_size=torrent.get("size_bytes", 0),
                        quality=torrent.get("quality", "unknown"),
                        source_provider="YTS",
                        source_url=torrent.get("url", ""),
                        seeders=torrent.get("seeds", 0),
                        leechers=torrent.get("peers", 0),
                        magnet=f"magnet:?xt=urn:btih:{torrent.get('hash', '')}",
                        date=movie.get("date_uploaded", ""),
                        category="movie",
                        yts_rating=movie.get("rating", 0),
                        yts_imdb=movie.get("imdb_code", ""),
                    ))
    except Exception as e:
        print(f"YTS search error: {e}")

    _cache_set(ck, results)
    return results


# ═══════════════════════════════════════════════════════════════════
#  PROVIDER: EZTV (TV Shows)
# ═══════════════════════════════════════════════════════════════════

_EZTV_API = "https://eztvx.to/api"

async def search_eztv(query: str, limit: int = 40) -> List[Dict]:
    """Search EZTV for TV show torrents."""
    if not httpx:
        return []
    
    ck = _cache_key("eztv", query)
    cached = _cache_get(ck)
    if cached is not None:
        return cached

    results = []
    
    # EZTV requires IMDB ID for best results, but supports name search too
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            # First try to find the show by name
            resp = await client.get(f"{_EZTV_API}/get-torrents", params={
                "limit": min(limit, 100),
                "page": 1,
            })
            if resp.status_code != 200:
                return []
            
            data = resp.json()
            torrents = data.get("torrents", [])
            
            query_lower = query.lower()
            for t in torrents:
                title = t.get("title", "")
                if query_lower not in title.lower():
                    continue
                
                results.append(_make_result(
                    file_name=title,
                    file_size=t.get("size_bytes", 0),
                    source_provider="EZTV",
                    source_url=t.get("episode_url", ""),
                    seeders=t.get("seeds", 0),
                    leechers=t.get("peers", 0),
                    magnet=t.get("magnet_url", ""),
                    date=t.get("date_released_unix", ""),
                    category="tv",
                    imdb_id=t.get("imdb_id", ""),
                ))
    except Exception as e:
        print(f"EZTV search error: {e}")

    _cache_set(ck, results[:limit])
    return results[:limit]


# ═══════════════════════════════════════════════════════════════════
#  PROVIDER: NyaaSi (Anime)
# ═══════════════════════════════════════════════════════════════════

_NYAA_URL = "https://nyaa.si"

async def search_nyaa(query: str, limit: int = 40) -> List[Dict]:
    """Search Nyaa.si for anime torrents."""
    if not httpx:
        return []
    
    ck = _cache_key("nyaa", query)
    cached = _cache_get(ck)
    if cached is not None:
        return cached

    results = []
    
    try:
        async with httpx.AsyncClient(timeout=8, follow_redirects=True) as client:
            resp = await client.get(_NYAA_URL, params={
                "f": 0,  # No filter
                "c": "1_2",  # Anime - English translated
                "q": query,
                "s": "seeders",
                "o": "desc",
            }, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            })
            if resp.status_code != 200:
                return []
            
            html = resp.text
            # Parse rows from the results table
            rows = re.findall(
                r'<td colspan="2">\s*<a[^>]*href="(/view/\d+)"[^>]*title="([^"]+)"',
                html
            )
            sizes = re.findall(r'<td class="text-center">(\d+(?:\.\d+)?\s*[KMGT]iB)</td>', html)
            seeds_leech = re.findall(
                r'<td class="text-center" style="color: green;">(\d+)</td>\s*<td class="text-center" style="color: red;">(\d+)</td>',
                html
            )
            
            for i, (path, name) in enumerate(rows[:limit]):
                size_str = sizes[i].replace("iB", "B") if i < len(sizes) else ""
                s, l = (int(seeds_leech[i][0]), int(seeds_leech[i][1])) if i < len(seeds_leech) else (0, 0)
                
                results.append(_make_result(
                    file_name=name.strip(),
                    file_size=_parse_size(size_str),
                    source_provider="Nyaa",
                    source_url=f"{_NYAA_URL}{path}",
                    seeders=s,
                    leechers=l,
                    category="anime",
                ))
    except Exception as e:
        print(f"Nyaa search error: {e}")

    _cache_set(ck, results)
    return results


# ═══════════════════════════════════════════════════════════════════
#  PROVIDER: LimeTorrents
# ═══════════════════════════════════════════════════════════════════

async def search_limetorrents(query: str, limit: int = 30) -> List[Dict]:
    """Search LimeTorrents."""
    if not httpx:
        return []
    
    ck = _cache_key("lime", query)
    cached = _cache_get(ck)
    if cached is not None:
        return cached

    results = []
    
    try:
        async with httpx.AsyncClient(timeout=8, follow_redirects=True) as client:
            url = f"https://www.limetorrents.lol/search/all/{query.replace(' ', '-')}/seeds/1/"
            resp = await client.get(url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            })
            if resp.status_code != 200:
                return []
            
            html = resp.text
            rows = re.findall(
                r'<td class="tdleft">\s*<a href="([^"]+)"[^>]*>([^<]+)</a>.*?'
                r'<td class="tdnormal">([^<]*)</td>.*?'
                r'<td class="tdseed">(\d+)</td>\s*<td class="tdleech">(\d+)</td>',
                html, re.DOTALL
            )
            
            for path, name, size_str, seeds, leeches in rows[:limit]:
                results.append(_make_result(
                    file_name=name.strip(),
                    file_size=_parse_size(size_str.strip()),
                    source_provider="LimeTorrents",
                    source_url=f"https://www.limetorrents.lol{path}",
                    seeders=int(seeds),
                    leechers=int(leeches),
                    category="torrent",
                ))
    except Exception as e:
        print(f"LimeTorrents search error: {e}")

    _cache_set(ck, results)
    return results


# ═══════════════════════════════════════════════════════════════════
#  PROVIDER REGISTRY & AGGREGATOR
# ═══════════════════════════════════════════════════════════════════

# All available providers
PROVIDERS = {
    "1337x":          {"fn": search_1337x,          "type": "general",  "label": "1337x",          "emoji": "🔥"},
    "piratebay":      {"fn": search_piratebay,      "type": "general",  "label": "PirateBay",      "emoji": "☠️"},
    "torrentgalaxy":  {"fn": search_torrentgalaxy,  "type": "general",  "label": "TorrentGalaxy",  "emoji": "🌌"},
    "limetorrents":   {"fn": search_limetorrents,   "type": "general",  "label": "LimeTorrents",   "emoji": "🍋"},
    "yts":            {"fn": search_yts,            "type": "movie",    "label": "YTS/YIFY",       "emoji": "🎬"},
    "eztv":           {"fn": search_eztv,           "type": "tv",       "label": "EZTV",           "emoji": "📺"},
    "nyaa":           {"fn": search_nyaa,           "type": "anime",    "label": "Nyaa.si",        "emoji": "🌸"},
}

def get_providers_for_type(media_type: str = "all") -> list:
    """Get relevant providers for a media type."""
    if media_type == "all":
        return list(PROVIDERS.keys())
    
    providers = []
    for key, info in PROVIDERS.items():
        if info["type"] in ("general", media_type):
            providers.append(key)
    return providers


async def search_all_providers(
    query: str,
    media_type: str = "all",
    enabled_providers: list = None,
    limit_per_provider: int = 30,
    timeout: float = 10.0,
) -> Dict:
    """
    Search all enabled providers concurrently and aggregate results.
    
    Returns:
        {
            "results": [...],  # Unified result list
            "providers_searched": ["1337x", "piratebay", ...],
            "provider_counts": {"1337x": 15, ...},
            "errors": {"eztv": "timeout", ...},
            "total": int,
        }
    """
    if enabled_providers is None:
        enabled_providers = get_providers_for_type(media_type)
    
    # Filter to valid providers
    active = {k: PROVIDERS[k] for k in enabled_providers if k in PROVIDERS}
    
    # Launch all searches concurrently
    tasks = {}
    for key, info in active.items():
        tasks[key] = asyncio.create_task(
            asyncio.wait_for(info["fn"](query, limit=limit_per_provider), timeout=timeout)
        )
    
    all_results = []
    provider_counts = {}
    errors = {}
    
    for key, task in tasks.items():
        try:
            results = await task
            provider_counts[key] = len(results)
            all_results.extend(results)
        except asyncio.TimeoutError:
            errors[key] = "timeout"
            provider_counts[key] = 0
        except Exception as e:
            errors[key] = str(e)[:200]
            provider_counts[key] = 0
    
    # Deduplicate by file name (keep highest seeder count)
    seen = {}
    deduped = []
    for r in all_results:
        fn_key = re.sub(r'[^a-z0-9]', '', r["file_name"].lower())
        if fn_key in seen:
            existing = seen[fn_key]
            if r.get("seeders", 0) > existing.get("seeders", 0):
                deduped[deduped.index(existing)] = r
                seen[fn_key] = r
        else:
            seen[fn_key] = r
            deduped.append(r)
    
    # Sort by seeders (health indicator)
    deduped.sort(key=lambda x: x.get("seeders", 0), reverse=True)
    
    return {
        "results": deduped,
        "providers_searched": list(active.keys()),
        "provider_counts": provider_counts,
        "errors": errors,
        "total": len(deduped),
    }


def get_provider_list() -> List[Dict]:
    """Return provider metadata for the frontend."""
    return [
        {
            "key": key,
            "label": info["label"],
            "emoji": info["emoji"],
            "type": info["type"],
        }
        for key, info in PROVIDERS.items()
    ]
