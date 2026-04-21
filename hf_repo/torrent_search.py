"""
ATMOS Torrent Search Engine v2 — Ultra Smart
- Token-based fuzzy title matching (handles complex filenames)
- Sources: YTS, TPB (apibay.org), NYAA, 1337x, EZTV, Magnetdl
- Concurrent search, dedup by hash, smart ranking
"""
import re, json, math, asyncio, urllib.request, urllib.parse, xml.etree.ElementTree as ET
from typing import Optional

# ── Known noise tokens to strip from filenames ─────────────────────
_NOISE = {
    "2160p","4k","1080p","720p","480p","360p",
    "bluray","blu","ray","bdrip","brrip","hdrip","dvdrip","webrip","web","dl",
    "x264","x265","hevc","avc","av1","h264","h265","xvid","divx",
    "aac","ac3","dts","atmos","ddp","dd","truehd","flac","mp3",
    "10bit","8bit","hdr","sdr","hdr10","hlg",
    "yify","yts","rarbg","ettv","eztv","flux","ntb","bia","joy","cmrg",
    "extended","theatrical","remastered","directors","cut","retail","proper",
    "complete","season","episode","part","vol","volume",
    "mkv","mp4","avi","mov","m2ts","ts",
    "english","hindi","tamil","telugu","dubbed","multi","dual","audio",
    "esub","esubs","sub","subs","subtitle",
}

_YEAR_RE = re.compile(r'\b(19|20)\d{2}\b')
_SE_RE   = re.compile(r's(\d{1,2})e(\d{1,2})', re.I)
_S_RE    = re.compile(r's(\d{1,2})', re.I)


def normalize_title(raw: str) -> str:
    """
    Extract clean title from messy filename.
    'Loki.S02E01.1080p.WEB-DL.DDP5.1.H.264-FLUX' → 'loki'
    'The.Dark.Knight.2008.IMAX.BluRay.x264' → 'the dark knight'
    """
    s = raw
    # Remove file extension
    s = re.sub(r'\.(mkv|mp4|avi|mov|m2ts|ts|srt|ass)$', '', s, flags=re.I)
    # Replace dots, underscores, hyphens with spaces
    s = re.sub(r'[._\-]+', ' ', s)
    # Remove brackets and their contents (often release group or tags)
    s = re.sub(r'\[.*?\]|\(.*?\)', ' ', s)
    # Lowercase and split
    tokens = s.lower().split()
    clean = []
    for t in tokens:
        # Stop at year
        if _YEAR_RE.match(t):
            break
        # Stop at season/episode marker
        if _SE_RE.match(t) or _S_RE.match(t):
            break
        # Stop at quality marker
        if t in _NOISE or re.match(r'^\d+(p|bit)$', t):
            break
        clean.append(t)
    return ' '.join(clean).strip()


def _token_similarity(query: str, title: str) -> float:
    """
    Token-overlap Jaccard similarity between query and extracted title.
    Returns 0.0–1.0.
    """
    q_words = set(re.sub(r'[^a-z0-9\s]', '', query.lower()).split())
    t_words = set(re.sub(r'[^a-z0-9\s]', '', title.lower()).split())
    if not q_words:
        return 0.0
    # Remove very short stop words
    q_words -= {'the', 'a', 'an', 'of', 'in', 'and', 'to', 'is'}
    t_words -= {'the', 'a', 'an', 'of', 'in', 'and', 'to', 'is'}
    if not q_words:
        return 0.5
    inter = len(q_words & t_words)
    union = len(q_words | t_words)
    jaccard = inter / union if union else 0
    # Bonus: if query is fully contained in title
    q_str = ' '.join(sorted(q_words))
    t_str = ' '.join(sorted(t_words))
    if q_str in t_str or all(w in t_words for w in q_words):
        jaccard = max(jaccard, 0.85)
    return round(jaccard, 3)


def _extract_quality(s: str) -> str:
    s = s.upper()
    for q in ["2160P","4K","1080P","720P","480P","360P"]:
        if q in s:
            return q.lower()
    return "unknown"

def _extract_se(s: str):
    m = _SE_RE.search(s)
    if m: return int(m.group(1)), int(m.group(2))
    m2 = re.search(r'season\s*(\d+)', s, re.I)
    if m2: return int(m2.group(1)), None
    return None, None

def _parse_size(s: str) -> int:
    try:
        m = re.search(r'([\d.]+)\s*(GiB|GB|MiB|MB|KiB|KB|B)', s, re.I)
        if not m: return 0
        val, unit = float(m.group(1)), m.group(2).upper()
        mult = {"GIB":1<<30,"GB":10**9,"MIB":1<<20,"MB":10**6,"KIB":1<<10,"KB":10**3,"B":1}
        return int(val * mult.get(unit, 1))
    except Exception: return 0

def _human(b: int) -> str:
    if not b: return ""
    for u in ["B","KB","MB","GB","TB"]:
        if b < 1024: return f"{b:.1f} {u}"
        b //= 1024
    return f"{b} PB"

def _get(url: str, timeout=9) -> str:
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/json,application/xml,*/*",
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="ignore")

def _result(title, clean_title, quality, size_bytes, seeds, magnet, source,
            season=None, episode=None, lang="", codec="", year=""):
    return {
        "title": title, "clean_title": clean_title, "year": str(year or ""),
        "quality": quality, "size": _human(size_bytes), "size_bytes": size_bytes,
        "seeds": seeds, "magnet": magnet, "source": source,
        "season": season, "episode": episode, "language": lang, "codec": codec,
        "score": 0, "similarity": 0.0,
    }


# ── YTS ───────────────────────────────────────────────────────────
def search_yts(query: str, quality: str = "1080p", limit: int = 12) -> list:
    try:
        q = urllib.parse.quote(query)
        url = f"https://yts.mx/api/v2/list_movies.json?query_term={q}&limit={limit}&sort_by=seeds"
        data = json.loads(_get(url))
        movies = data.get("data", {}).get("movies") or []
        results = []
        for m in movies:
            for t in m.get("torrents", []):
                tq = t.get("quality", "")
                h = t.get("hash", "")
                if not h: continue
                magnet = (f"magnet:?xt=urn:btih:{h}&dn={urllib.parse.quote(m.get('title_long',''))}"
                          "&tr=udp://open.demonii.com:1337&tr=udp://tracker.openbittorrent.com:80")
                clean = normalize_title(m.get("title", ""))
                results.append(_result(
                    title=m.get("title_long", m.get("title", "")),
                    clean_title=clean, quality=tq or _extract_quality(tq),
                    size_bytes=t.get("size_bytes", 0), seeds=t.get("seeds", 0),
                    magnet=magnet, source="YTS", year=m.get("year"),
                    codec=t.get("video_codec", ""),
                ))
        return results
    except Exception as e:
        print(f"YTS error: {e}"); return []


# ── The Pirate Bay ────────────────────────────────────────────────
def search_tpb(query: str, limit: int = 20) -> list:
    try:
        q = urllib.parse.quote(query)
        url = f"https://apibay.org/q.php?q={q}&cat=200,207,208,500,205"
        data = json.loads(_get(url))
        if not isinstance(data, list): return []
        results = []
        for t in data[:limit]:
            name = t.get("name", "")
            ih = t.get("info_hash", "")
            if not ih or ih == "0"*40: continue
            magnet = (f"magnet:?xt=urn:btih:{ih}&dn={urllib.parse.quote(name)}"
                      "&tr=udp://tracker.openbittorrent.com:80&tr=udp://open.demonii.com:1337")
            size_bytes = int(t.get("size", 0))
            seeds = int(t.get("seeders", 0))
            s, e = _extract_se(name)
            clean = normalize_title(name)
            results.append(_result(
                title=name, clean_title=clean,
                quality=_extract_quality(name), size_bytes=size_bytes,
                seeds=seeds, magnet=magnet, source="TPB",
                season=s, episode=e,
            ))
        return results
    except Exception as e:
        print(f"TPB error: {e}"); return []


# ── NYAA ──────────────────────────────────────────────────────────
def search_nyaa(query: str, limit: int = 15) -> list:
    try:
        q = urllib.parse.quote(query)
        url = f"https://nyaa.si/?page=rss&q={q}&c=1_0&f=0"
        xml = _get(url)
        root = ET.fromstring(xml)
        ns = {"nyaa": "https://nyaa.si/xmlns/nyaa"}
        results = []
        for item in root.findall(".//item")[:limit]:
            title = item.findtext("title", "")
            magnet = item.findtext("link", "") or ""
            if not magnet.startswith("magnet:"):
                enc = item.find("enclosure")
                magnet = enc.get("url","") if enc is not None else ""
            if not magnet.startswith("magnet:"): continue
            seeds_el = item.find("nyaa:seeders", ns)
            seeds = int(seeds_el.text or 0) if seeds_el is not None else 0
            size_el = item.find("nyaa:size", ns)
            size_str = size_el.text or "" if size_el is not None else ""
            clean = normalize_title(title)
            results.append(_result(
                title=title, clean_title=clean, quality=_extract_quality(title),
                size_bytes=_parse_size(size_str), seeds=seeds,
                magnet=magnet, source="NYAA", lang="JPN/ENG",
            ))
        return results
    except Exception as e:
        print(f"NYAA error: {e}"); return []


# ── EZTV (TV shows — has actual JSON API) ─────────────────────────
def search_eztv(query: str, limit: int = 15) -> list:
    """EZTV has a public JSON API — best source for TV episodes."""
    try:
        q = urllib.parse.quote(query)
        url = f"https://eztv.re/api/get-torrents?keywords={q}&limit={limit}"
        data = json.loads(_get(url))
        torrents = data.get("torrents") or []
        results = []
        for t in torrents:
            name = t.get("filename", "") or t.get("title", "")
            magnet = t.get("magnet_url", "")
            if not magnet: continue
            seeds = int(t.get("seeds", 0))
            size_bytes = int(t.get("size_bytes", 0))
            s, e = _extract_se(name)
            clean = normalize_title(name)
            results.append(_result(
                title=name, clean_title=clean, quality=_extract_quality(name),
                size_bytes=size_bytes, seeds=seeds,
                magnet=magnet, source="EZTV",
                season=s, episode=e,
            ))
        return results
    except Exception as e:
        print(f"EZTV error: {e}"); return []


# ── 1337x ─────────────────────────────────────────────────────────
def search_1337x(query: str, limit: int = 8) -> list:
    try:
        q = urllib.parse.quote_plus(query)
        html = _get(f"https://1337x.to/search/{q}/1/", timeout=10)
        links = re.findall(r'href="(/torrent/\d+/[^"]+/)"', html)[:limit]
        results = []
        for link in links:
            try:
                detail = _get(f"https://1337x.to{link}", timeout=8)
                magnet_m = re.search(r'(magnet:\?xt=urn:btih:[^"&\s]+)', detail)
                if not magnet_m: continue
                magnet = magnet_m.group(1)
                name_m = re.search(r'<title>([^<]+) Torrent', detail)
                name = name_m.group(1).strip() if name_m else link
                seeds_m = re.search(r'Seeders.*?<span[^>]*>(\d+)', detail)
                seeds = int(seeds_m.group(1)) if seeds_m else 0
                size_m = re.search(r'Size.*?<span[^>]*>([\d.]+ \w+)', detail)
                size_bytes = _parse_size(size_m.group(1)) if size_m else 0
                s, e = _extract_se(name)
                clean = normalize_title(name)
                results.append(_result(
                    title=name, clean_title=clean, quality=_extract_quality(name),
                    size_bytes=size_bytes, seeds=seeds, magnet=magnet, source="1337x",
                    season=s, episode=e,
                ))
            except Exception: continue
        return results
    except Exception as e:
        print(f"1337x error: {e}"); return []


# ── Magnetdl ──────────────────────────────────────────────────────
def search_magnetdl(query: str, limit: int = 10) -> list:
    try:
        slug = query.lower()[0]
        q = urllib.parse.quote_plus(query)
        url = f"https://www.magnetdl.com/{slug}/{q}/"
        html = _get(url, timeout=10)
        rows = re.findall(r'magnet:\?xt=urn:btih:[a-fA-F0-9]+[^"]*', html)
        names = re.findall(r'class="n"[^>]*><a[^>]*>([^<]+)</a>', html)
        seeds_list = re.findall(r'class="s">(\d+)<', html)
        results = []
        for i, magnet in enumerate(rows[:limit]):
            name = names[i] if i < len(names) else "Unknown"
            seeds = int(seeds_list[i]) if i < len(seeds_list) else 0
            s, e = _extract_se(name)
            clean = normalize_title(name)
            results.append(_result(
                title=name, clean_title=clean, quality=_extract_quality(name),
                size_bytes=0, seeds=seeds, magnet=magnet, source="Magnetdl",
                season=s, episode=e,
            ))
        return results
    except Exception as e:
        print(f"Magnetdl error: {e}"); return []


# ── Bitsearch.to (JSON API) ────────────────────────────────────
def search_bitsearch(query: str, limit: int = 15) -> list:
    """Bitsearch has a public JSON search API."""
    try:
        q = urllib.parse.quote(query)
        url = f"https://bitsearch.to/search?q={q}&category=1&subcat=movie"
        html = _get(url, timeout=10)
        # Extract JSON-LD or data attributes
        # Bitsearch returns HTML with torrent cards
        names  = re.findall(r'<h5 class="title"[^>]*><a[^>]*>([^<]+)</a>', html)
        hashes = re.findall(r'btih:([a-fA-F0-9]{40})', html, re.I)
        seeds_list = re.findall(r'<span[^>]*class="[^"]*seed[^"]*"[^>]*>(\d+)', html, re.I)
        sizes  = re.findall(r'<span[^>]*class="[^"]*size[^"]*"[^>]*>([^<]+)<', html, re.I)
        results = []
        for i, ih in enumerate(hashes[:limit]):
            name = names[i].strip() if i < len(names) else "Unknown"
            seeds = int(seeds_list[i]) if i < len(seeds_list) else 0
            size_bytes = _parse_size(sizes[i]) if i < len(sizes) else 0
            magnet = (f"magnet:?xt=urn:btih:{ih}&dn={urllib.parse.quote(name)}"
                      "&tr=udp://tracker.openbittorrent.com:80")
            s, e = _extract_se(name)
            results.append(_result(
                title=name, clean_title=normalize_title(name),
                quality=_extract_quality(name), size_bytes=size_bytes,
                seeds=seeds, magnet=magnet, source="Bitsearch",
                season=s, episode=e,
            ))
        return results
    except Exception as ex:
        print(f"Bitsearch error: {ex}"); return []


# ── TorrentGalaxy / TGx ──────────────────────────────────
def search_tgx(query: str, limit: int = 12) -> list:
    """TorrentGalaxy — large database, good for HD movies/TV."""
    try:
        q = urllib.parse.quote_plus(query)
        url = f"https://torrentgalaxy.to/torrents.php?search={q}&sort=seeders&order=desc"
        html = _get(url, timeout=10)
        magnets = re.findall(r'(magnet:\?xt=urn:btih:[a-fA-F0-9]+[^"\s]*)', html)
        names   = re.findall(r'class="txlight"[^>]*>([^<]+)</a>', html)
        seeds_l = re.findall(r'<span class="label label-success">(\d+)<', html)
        sizes_l = re.findall(r'<small>(\d+\.?\d*\s*(?:GB|MB|GiB|MiB))</small>', html, re.I)
        results = []
        for i, magnet in enumerate(magnets[:limit]):
            name = names[i].strip() if i < len(names) else "Unknown"
            seeds = int(seeds_l[i]) if i < len(seeds_l) else 0
            size_bytes = _parse_size(sizes_l[i]) if i < len(sizes_l) else 0
            s, e = _extract_se(name)
            results.append(_result(
                title=name, clean_title=normalize_title(name),
                quality=_extract_quality(name), size_bytes=size_bytes,
                seeds=seeds, magnet=magnet, source="TGx",
                season=s, episode=e,
            ))
        return results
    except Exception as ex:
        print(f"TGx error: {ex}"); return []


# ── Limetorrents ────────────────────────────────────────
def search_limetorrents(query: str, limit: int = 10) -> list:
    try:
        q = urllib.parse.quote_plus(query)
        url = f"https://www.limetorrents.lol/search/all/{q}/seeds/1/"
        html = _get(url, timeout=10)
        # Extract torrent rows
        rows = re.findall(
            r'<td class="tdleft"><a[^>]+>([^<]+)</a>.*?'
            r'info_hash=([a-fA-F0-9]{40}).*?'
            r'<td class="tdseed">(\d+)</td>.*?'
            r'<td class="tdleft2">([^<]+)</td>',
            html, re.S)
        results = []
        for name, ih, seeds, size_str in rows[:limit]:
            name = name.strip()
            magnet = (f"magnet:?xt=urn:btih:{ih}&dn={urllib.parse.quote(name)}"
                      "&tr=udp://tracker.openbittorrent.com:80")
            s, e = _extract_se(name)
            results.append(_result(
                title=name, clean_title=normalize_title(name),
                quality=_extract_quality(name), size_bytes=_parse_size(size_str),
                seeds=int(seeds), magnet=magnet, source="Limetorrents",
                season=s, episode=e,
            ))
        return results
    except Exception as ex:
        print(f"Limetorrents error: {ex}"); return []


# ── TorLock ────────────────────────────────────────────
def search_torlock(query: str, limit: int = 10) -> list:
    try:
        q = urllib.parse.quote_plus(query)
        url = f"https://www.torlock.com/all/torrents/{q}.html?sort=seeds"
        html = _get(url, timeout=10)
        names  = re.findall(r'<a href="/torrent/\d+/[^"]+">([^<]+)</a>', html)
        hashes = re.findall(r'/torrent/(\d+)/', html)
        seeds_list = re.findall(r'<td>(\d+)</td>\s*<td>\d+</td>\s*</tr>', html)
        results = []
        for i, name in enumerate(names[:limit]):
            name = name.strip()
            ih = hashes[i] if i < len(hashes) else ""
            seeds = int(seeds_list[i]) if i < len(seeds_list) else 0
            if not ih: continue
            # TorLock uses numeric IDs not hashes; build a search magnet
            magnet = f"magnet:?xt=urn:btih:{ih}&dn={urllib.parse.quote(name)}&tr=udp://tracker.openbittorrent.com:80"
            s, e = _extract_se(name)
            results.append(_result(
                title=name, clean_title=normalize_title(name),
                quality=_extract_quality(name), size_bytes=0,
                seeds=seeds, magnet=magnet, source="TorLock",
                season=s, episode=e,
            ))
        return results
    except Exception as ex:
        print(f"TorLock error: {ex}"); return []


# ── Kickass Torrents (kat.am public API) ────────────────────
def search_kickass(query: str, limit: int = 12) -> list:
    """Kickass Torrents has a search API via JSON endpoint."""
    try:
        q = urllib.parse.quote(query)
        url = f"https://katcr.to/api/torrents/search/?q={q}&sort=seeders&order=desc"
        data = json.loads(_get(url, timeout=9))
        items = data if isinstance(data, list) else data.get("results", data.get("torrents", []))
        results = []
        for t in items[:limit]:
            name = t.get("title") or t.get("name", "")
            ih   = t.get("hash") or t.get("info_hash", "")
            seeds = int(t.get("seeds", 0) or 0)
            size_bytes = int(t.get("size", 0) or 0)
            if not ih: continue
            magnet = (f"magnet:?xt=urn:btih:{ih}&dn={urllib.parse.quote(name)}"
                      "&tr=udp://tracker.openbittorrent.com:80")
            s, e = _extract_se(name)
            results.append(_result(
                title=name, clean_title=normalize_title(name),
                quality=_extract_quality(name), size_bytes=size_bytes,
                seeds=seeds, magnet=magnet, source="Kickass",
                season=s, episode=e,
            ))
        return results
    except Exception as ex:
        print(f"Kickass error: {ex}"); return []


# ── Ranking ───────────────────────────────────────────────────────
SOURCE_TRUST = {
    "YTS":16, "EZTV":14, "NYAA":13, "Kickass":11, "TGx":10,
    "Bitsearch":10, "TPB":9, "1337x":8, "Magnetdl":7,
    "Limetorrents":7, "TorLock":6,
}
QUALITY_SCORE = {"2160p":5,"4k":5,"1080p":10,"720p":7,"480p":4,"360p":2,"unknown":1}

def rank_results(results: list, query: str, pref_quality="1080p") -> list:
    """Score = quality_match + seed_score + source_trust + title_similarity*30"""
    for r in results:
        q = r.get("quality","unknown")
        q_score = QUALITY_SCORE.get(q, 1)
        if pref_quality.lower() in q.lower():
            q_score += 8
        seeds = min(r.get("seeds",0), 3000)
        seed_score = math.log2(seeds + 1) * 2.5
        src = SOURCE_TRUST.get(r.get("source",""), 5)
        # Fuzzy similarity: compare query against clean extracted title
        sim = _token_similarity(query, r.get("clean_title","") or r.get("title",""))
        r["similarity"] = sim
        sim_score = sim * 30
        r["score"] = round(q_score + seed_score + src + sim_score, 1)
    # Sort by score descending, but penalize zero-seeder results
    return sorted(results, key=lambda x: (x["seeds"]>0, x["score"]), reverse=True)


# ── Deduplication ─────────────────────────────────────────────────
def _dedup(results: list) -> list:
    seen = set()
    out = []
    for r in results:
        h = re.search(r'btih:([a-fA-F0-9]+)', r.get("magnet",""), re.I)
        key = h.group(1).upper() if h else r.get("title","")[:60]
        if key not in seen:
            seen.add(key)
            out.append(r)
    return out


# ── Main unified search ───────────────────────────────────────────
async def search_all(query: str, quality="1080p", media_type="auto",
                     season: Optional[int]=None, episode: Optional[int]=None,
                     limit=40) -> dict:
    """
    Search ALL 11 sources concurrently.
    media_type: 'movie' | 'tv' | 'anime' | 'auto'
    """
    tq = query
    if season:  tq += f" S{season:02d}"
    if episode: tq += f"E{episode:02d}"

    loop = asyncio.get_event_loop()
    fns = []

    # Always-on: TPB + Bitsearch + TGx + Kickass cover everything
    fns += [
        loop.run_in_executor(None, search_tpb,        tq,           20),
        loop.run_in_executor(None, search_bitsearch,  tq,           15),
        loop.run_in_executor(None, search_tgx,        tq,           12),
        loop.run_in_executor(None, search_kickass,    tq,           12),
        loop.run_in_executor(None, search_magnetdl,   tq,           10),
        loop.run_in_executor(None, search_limetorrents, tq,         10),
        loop.run_in_executor(None, search_torlock,    tq,           10),
    ]

    if media_type in ("movie", "auto"):
        fns.append(loop.run_in_executor(None, search_yts, query, quality, 12))

    if media_type in ("tv", "auto"):
        fns.append(loop.run_in_executor(None, search_eztv,  tq, 15))
        fns.append(loop.run_in_executor(None, search_1337x, tq, 8))

    if media_type in ("anime", "auto"):
        fns.append(loop.run_in_executor(None, search_nyaa, tq, 15))

    all_results: list = []
    for fut in asyncio.as_completed(fns):
        try:
            res = await fut
            all_results.extend(res)
        except Exception: pass

    deduped = _dedup(all_results)
    ranked  = rank_results(deduped, query, quality)

    filtered = [r for r in ranked if r["similarity"] >= 0.2 or r["seeds"] > 5]
    if not filtered:
        filtered = ranked

    if episode:
        ep_filtered = [r for r in filtered if r.get("episode")==episode or r.get("episode") is None]
        if ep_filtered:
            filtered = ep_filtered

    final = filtered[:limit]
    return {
        "query": query, "total": len(final),
        "results": final,
        "sources_used": list({r["source"] for r in final}),
        "top_similarity": max((r["similarity"] for r in final), default=0),
    }
