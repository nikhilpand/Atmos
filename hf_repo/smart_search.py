"""
Smart Search Engine V1.0 — Ultra Pro Max Search → Score → Group → Forward Pipeline.
Searches Telegram for movies/shows, scores results, groups by season/episode,
verifies completeness, and forwards the best matches to the ATMOS pipeline.
"""
import re
import math
import time
import asyncio
from collections import defaultdict
from media_classifier import MediaClassifier

# ── Title normalizer (same algorithm as torrent_search) ──────────
_NOISE_TOKENS = {
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
_YEAR_PAT = re.compile(r'\b(19|20)\d{2}\b')
_SE_PAT   = re.compile(r's(\d{1,2})e(\d{1,2})', re.I)
_S_PAT    = re.compile(r's(\d{1,2})', re.I)

def _extract_clean_title(raw: str) -> str:
    """Strip all codec/quality/release-group noise from a filename, return clean title."""
    s = re.sub(r'\.(mkv|mp4|avi|mov|m2ts|ts|srt|ass)$', '', raw, flags=re.I)
    s = re.sub(r'[._\-]+', ' ', s)
    s = re.sub(r'\[.*?\]|\(.*?\)', ' ', s)
    tokens = s.lower().split()
    clean = []
    for t in tokens:
        if _YEAR_PAT.match(t): break
        if _SE_PAT.match(t) or _S_PAT.match(t): break
        if t in _NOISE_TOKENS or re.match(r'^\d+(p|bit)$', t): break
        clean.append(t)
    return ' '.join(clean).strip()

# ═══════════════════════════════════════════════════════════════════
#  SCORING ENGINE — Weighted composite score (0–100)
# ═══════════════════════════════════════════════════════════════════

QUALITY_SCORES = {
    '2160p': 20, '4k': 20,   # Capped — user prefers 1080p
    '1080p': 30,              # Max score — preferred quality
    '720p': 18,
    '480p': 10,
    '360p': 5,
    'unknown': 3,
}

CODEC_SCORES = {
    'HEVC': 10, 'AV1': 9, 'AVC': 7, 'VP9': 6,
}

SOURCE_TRUST = {
    'WEB-DL': 15, 'BluRay': 14, 'BDRip': 12, 'WEBRip': 10,
    'Netflix': 13, 'AMZN': 13, 'Disney+': 12, 'HBO Max': 12,
    'JioCinema': 10, 'HDRip': 8, 'DVDRip': 6, 'CAMRip': 2,
}


def score_result(result, preferences=None):
    """Score a single search result (0–100) based on weighted factors."""
    prefs = preferences or {}
    pref_quality = prefs.get('quality', '1080p')
    pref_lang = prefs.get('language', '')

    score = 0.0

    # 1. Quality (30%) — bonus if matches preference
    q = (result.get('quality') or 'unknown').lower()
    q_key = q.replace('p', 'p') if 'p' in q else q
    base_q = QUALITY_SCORES.get(q_key, QUALITY_SCORES.get(q, 3))
    if pref_quality and pref_quality.lower() in q.lower():
        base_q = 30  # Exact match gets full marks
    score += base_q

    # 2. File Size (15%) — log scale, larger is better (capped at 10GB)
    size = result.get('file_size', 0)
    if size > 0:
        normalized = min(math.log2(size / 1_000_000 + 1) / math.log2(10240), 1.0)
        score += normalized * 15
    else:
        score += 2

    # 3. Language Match (20%)
    parsed = result.get('_parsed', {})
    langs = parsed.get('languages', [])
    file_name = result.get('file_name', '')
    if pref_lang:
        pl = pref_lang.lower()
        if any(pl in l.lower() for l in langs):
            score += 20
        elif any('dual' in l.lower() for l in langs):
            score += 15
        elif pl in file_name.lower():
            score += 18
        else:
            score += 5
    else:
        score += 10  # No preference = neutral

    # 4. Source Credibility (15%)
    source = parsed.get('source', '')
    score += SOURCE_TRUST.get(source, 8)

    # 5. Recency (10%) — exponential decay over 365 days
    date_str = result.get('date', '')
    if date_str:
        try:
            from datetime import datetime
            d = datetime.strptime(date_str, '%Y-%m-%d')
            days_old = (datetime.now() - d).days
            recency = max(0, 10 * math.exp(-days_old / 365))
            score += recency
        except Exception:
            score += 5
    else:
        score += 5

    # 6. Codec Quality (10%)
    codec = parsed.get('codec', '')
    score += CODEC_SCORES.get(codec, 3)

    return round(min(score, 100), 1)


# ═══════════════════════════════════════════════════════════════════
#  PARSING & ENRICHMENT — Parse all results with MediaClassifier
# ═══════════════════════════════════════════════════════════════════

def enrich_results(results):
    """Parse each result's filename with MediaClassifier, attach parsed data."""
    for r in results:
        fn = r.get('file_name', '')
        parsed = MediaClassifier.parse(fn)
        r['_parsed'] = parsed
        r['parsed_title'] = parsed.get('title', '')
        r['parsed_type'] = parsed.get('type', 'movie')
        r['parsed_season'] = parsed.get('season')
        r['parsed_episode'] = parsed.get('episode')
        r['parsed_quality'] = parsed.get('quality') or r.get('quality', 'unknown')
        r['parsed_languages'] = parsed.get('languages', [])
        r['parsed_codec'] = parsed.get('codec', '')
        r['parsed_source'] = parsed.get('source', '')
        # Override quality from parser if not already set
        if not r.get('quality') or r.get('quality') == 'unknown':
            r['quality'] = r['parsed_quality']
    return results


# ═══════════════════════════════════════════════════════════════════
#  TITLE SIMILARITY — Fuzzy match to filter irrelevant results
# ═══════════════════════════════════════════════════════════════════

def _normalize(s):
    """Normalize string for comparison."""
    return re.sub(r'[^a-z0-9\s]', ' ', s.lower()).strip()

def title_similarity(query: str, filename_or_title: str) -> float:
    """
    Token-based Jaccard similarity with stop-word removal.
    Runs against BOTH the raw filename and the noise-stripped clean title,
    returns the maximum — so 'Loki.S02E01.1080p.WEB-DL-FLUX' matches query 'Loki'.
    """
    _STOP = {'the','a','an','of','in','and','to','is'}
    def _jaccard(q_words, t_words):
        q = q_words - _STOP
        t = t_words - _STOP
        if not q: return 0.5
        inter = len(q & t)
        union = len(q | t)
        base = inter / union if union else 0
        # Bonus: all query words appear in title
        if all(w in t for w in q):
            base = max(base, 0.85)
        return round(base, 3)

    q_words = set(re.findall(r'[a-z0-9]+', query.lower()))
    # Score against raw title
    raw_words = set(re.findall(r'[a-z0-9]+', filename_or_title.lower()))
    raw_sim = _jaccard(q_words, raw_words)
    # Score against clean title (noise stripped)
    clean = _extract_clean_title(filename_or_title)
    clean_words = set(re.findall(r'[a-z0-9]+', clean.lower()))
    clean_sim = _jaccard(q_words, clean_words)
    return max(raw_sim, clean_sim)


def filter_relevant(results, query, threshold=0.25):
    """
    Remove results irrelevant to query.
    Threshold lowered to 0.25 because the new algorithm is precise enough.
    """
    filtered = []
    for r in results:
        candidate = r.get('parsed_title', '') or _extract_clean_title(r.get('file_name', ''))
        sim = title_similarity(query, candidate)
        r['_relevance'] = sim
        r['_clean_title'] = _extract_clean_title(r.get('file_name',''))
        if sim >= threshold:
            filtered.append(r)
    # If nothing passes threshold, return top 5 by raw score (don't show empty)
    if not filtered and results:
        filtered = sorted(results, key=lambda x: x.get('_score',0), reverse=True)[:5]
    return filtered


# ═══════════════════════════════════════════════════════════════════
#  GROUPING ENGINE — Group by Show → Season → Episode
# ═══════════════════════════════════════════════════════════════════

def group_results(results, media_type='tv'):
    """Group scored results into a structured hierarchy."""
    if media_type == 'movie':
        return _group_movies(results)
    return _group_tv(results)


def _group_tv(results):
    """Group TV results: { season_num: { episode_num: [results sorted by score] } }"""
    seasons = defaultdict(lambda: defaultdict(list))
    for r in results:
        s = r.get('parsed_season') or 1
        e = r.get('parsed_episode') or 0
        seasons[s][e].append(r)

    # Sort each episode's results by score descending
    for s in seasons:
        for e in seasons[s]:
            seasons[s][e].sort(key=lambda x: x.get('_score', 0), reverse=True)

    return dict(sorted(seasons.items()))


def _group_movies(results):
    """Group movie results by title similarity, sorted by score."""
    results.sort(key=lambda x: x.get('_score', 0), reverse=True)
    return {'movies': results}


# ═══════════════════════════════════════════════════════════════════
#  SEASON COMPLETENESS VERIFIER — Ultra robust episode checker
# ═══════════════════════════════════════════════════════════════════

def verify_season_completeness(grouped, tmdb_episode_counts=None):
    """
    Ultra robust season completeness verification.
    
    Args:
        grouped: Output of group_results() — { season: { episode: [results] } }
        tmdb_episode_counts: Optional dict { season_num: expected_episode_count }
    
    Returns dict per season:
    {
        season_num: {
            "total_expected": int,
            "total_found": int,
            "missing_episodes": [int],
            "complete": bool,
            "completeness_pct": float,
            "quality_consistent": bool,
            "dominant_quality": str,
            "quality_breakdown": { "1080p": 5, "720p": 1 },
            "quality_mismatches": [{ episode, expected, actual }]
        }
    }
    """
    report = {}

    for season_num, episodes in grouped.items():
        if season_num == 'movies':
            continue

        ep_numbers = sorted([e for e in episodes.keys() if e > 0])
        if not ep_numbers:
            report[season_num] = {
                'total_expected': 0, 'total_found': 0,
                'missing_episodes': [], 'complete': False,
                'completeness_pct': 0, 'quality_consistent': False,
                'dominant_quality': 'unknown', 'quality_breakdown': {},
                'quality_mismatches': []
            }
            continue

        # Determine expected episode count
        expected_count = None
        if tmdb_episode_counts and season_num in tmdb_episode_counts:
            expected_count = tmdb_episode_counts[season_num]
        else:
            # Heuristic: use max episode number found
            expected_count = max(ep_numbers)

        # Find missing episodes
        full_range = set(range(1, expected_count + 1))
        found_set = set(ep_numbers)
        missing = sorted(full_range - found_set)

        # Quality analysis — check the BEST result for each episode
        quality_per_ep = {}
        for ep_num in ep_numbers:
            best = episodes[ep_num][0] if episodes[ep_num] else None
            if best:
                quality_per_ep[ep_num] = best.get('parsed_quality', 'unknown')

        # Quality breakdown
        q_breakdown = defaultdict(int)
        for q in quality_per_ep.values():
            q_breakdown[q] += 1

        # Dominant quality = most common
        dominant = max(q_breakdown, key=q_breakdown.get) if q_breakdown else 'unknown'

        # Quality mismatches
        mismatches = []
        for ep_num, q in quality_per_ep.items():
            if q != dominant:
                mismatches.append({
                    'episode': ep_num,
                    'expected': dominant,
                    'actual': q
                })

        completeness_pct = round(len(found_set) / expected_count * 100, 1) if expected_count else 0

        report[season_num] = {
            'total_expected': expected_count,
            'total_found': len(found_set),
            'missing_episodes': missing,
            'complete': len(missing) == 0,
            'completeness_pct': completeness_pct,
            'quality_consistent': len(mismatches) == 0,
            'dominant_quality': dominant,
            'quality_breakdown': dict(q_breakdown),
            'quality_mismatches': mismatches,
        }

    return report


# ═══════════════════════════════════════════════════════════════════
#  AUTO-SELECTION — Pick best file per episode with fallback chain
# ═══════════════════════════════════════════════════════════════════

QUALITY_RANK = {'2160p': 5, '4k': 5, '1080p': 4, '720p': 3, '480p': 2, '360p': 1, 'unknown': 0}

def auto_select(grouped, preferences):
    """
    For each episode, pick the single best file matching preferences.
    Uses a fallback chain:
      1. Exact quality + exact language
      2. Exact quality + Dual Audio
      3. Exact quality + any language
      4. One quality tier lower + exact language
      5. ... continue fallback
      6. Highest score regardless
    
    Returns list of selected results ready for pipeline forwarding.
    """
    pref_q = preferences.get('quality', '1080p').lower()
    pref_lang = preferences.get('language', '').lower()
    target_seasons = set(preferences.get('seasons', []))

    # Build quality fallback chain from preferred downward
    q_order = ['1080p', '720p', '480p', '360p']
    if pref_q in q_order:
        idx = q_order.index(pref_q)
        fallback_qualities = q_order[idx:]
    else:
        fallback_qualities = q_order

    selected = []

    for season_num, episodes in grouped.items():
        if season_num == 'movies':
            # For movies, just pick the best
            for r in episodes:
                selected.append(r)
                break
            continue

        if target_seasons and season_num not in target_seasons:
            continue

        for ep_num, candidates in episodes.items():
            if ep_num == 0:
                continue  # Skip season packs in individual mode

            pick = _pick_best(candidates, fallback_qualities, pref_lang)
            if pick:
                selected.append(pick)

    return selected


def _pick_best(candidates, quality_chain, pref_lang):
    """Pick best candidate using fallback chain."""
    if not candidates:
        return None

    for target_q in quality_chain:
        # Pass 1: exact quality + exact language
        for c in candidates:
            cq = (c.get('parsed_quality') or '').lower()
            langs = [l.lower() for l in c.get('parsed_languages', [])]
            fn_lower = c.get('file_name', '').lower()
            if target_q in cq:
                if pref_lang and (pref_lang in ' '.join(langs) or pref_lang in fn_lower):
                    return c

        # Pass 2: exact quality + dual audio
        for c in candidates:
            cq = (c.get('parsed_quality') or '').lower()
            langs = [l.lower() for l in c.get('parsed_languages', [])]
            if target_q in cq and any('dual' in l for l in langs):
                return c

        # Pass 3: exact quality + any language
        for c in candidates:
            cq = (c.get('parsed_quality') or '').lower()
            if target_q in cq:
                return c

    # Final fallback: highest scored candidate
    return candidates[0]


# ═══════════════════════════════════════════════════════════════════
#  PIPELINE ORCHESTRATOR — Search → Score → Group → Select → Forward
# ═══════════════════════════════════════════════════════════════════

async def smart_search(query, preferences=None, search_fn=None, tmdb_fn=None):
    """
    Full pipeline: search → enrich → filter → score → group → verify → select.
    
    Args:
        query: Search string (e.g., "Cobra Kai")
        preferences: { quality, language, seasons, auto_select }
        search_fn: async callable that returns raw search results
        tmdb_fn: callable that returns TMDB metadata
    
    Returns comprehensive result dict.
    """
    prefs = preferences or {}
    pref_quality = prefs.get('quality', '1080p')
    pref_lang = prefs.get('language', '')
    pref_seasons = prefs.get('seasons', [])
    do_auto_select = prefs.get('auto_select', False)

    # 1. TMDB metadata lookup
    tmdb_data = {}
    tmdb_episode_counts = {}
    if tmdb_fn:
        try:
            tmdb_data = tmdb_fn(query)
            # If TMDB returns season info, build episode count map
            for s in tmdb_data.get('seasons', []):
                sn = s.get('season_number', 0)
                if sn > 0:
                    tmdb_episode_counts[sn] = s.get('episode_count', 0)
        except Exception as e:
            print(f"⚠️ SmartSearch: TMDB lookup failed: {e}")

    # Determine media type
    media_type = tmdb_data.get('media_type', 'tv' if tmdb_data.get('seasons') else 'movie')

    # 2. Search Telegram
    raw_results = []
    if search_fn:
        try:
            raw_results = await search_fn(query)
        except Exception as e:
            print(f"⚠️ SmartSearch: Search failed: {e}")
            return {'error': str(e), 'results': [], 'total': 0}

    if not raw_results:
        return {
            'query': query, 'tmdb': tmdb_data, 'groups': {},
            'total_results': 0, 'completeness': {},
            'selected': [], 'available_qualities': [], 'available_languages': []
        }

    # 3. Enrich with MediaClassifier
    results = enrich_results(raw_results)

    # 4. Filter irrelevant results
    results = filter_relevant(results, query, threshold=0.4)

    # 5. Score each result
    for r in results:
        r['_score'] = score_result(r, prefs)

    # 6. Group by season/episode
    grouped = group_results(results, media_type)

    # 7. Verify season completeness
    completeness = {}
    if media_type == 'tv':
        completeness = verify_season_completeness(grouped, tmdb_episode_counts)

    # 8. Extract available qualities and languages
    all_qualities = set()
    all_languages = set()
    for r in results:
        q = r.get('parsed_quality', 'unknown')
        if q:
            all_qualities.add(q)
        for lang in r.get('parsed_languages', []):
            all_languages.add(lang)

    # 9. Auto-select if requested
    selected = []
    if do_auto_select:
        selected = auto_select(grouped, prefs)

    # 10. Build response
    # Serialize groups for JSON
    serialized_groups = {}
    if media_type == 'tv':
        for s_num, episodes in grouped.items():
            s_key = str(s_num)
            serialized_groups[s_key] = {}
            for e_num, candidates in episodes.items():
                e_key = str(e_num)
                serialized_groups[s_key][e_key] = {
                    'best': _serialize_result(candidates[0]) if candidates else None,
                    'alternatives': [_serialize_result(c) for c in candidates[1:5]],
                    'count': len(candidates),
                }
    else:
        serialized_groups = {
            'movies': [_serialize_result(r) for r in results[:20]]
        }

    return {
        'query': query,
        'tmdb': {
            'title': tmdb_data.get('tmdb_title', ''),
            'year': tmdb_data.get('release_date', '')[:4] if tmdb_data.get('release_date') else '',
            'poster_url': tmdb_data.get('poster_url', ''),
            'backdrop_url': tmdb_data.get('backdrop_url', ''),
            'rating': tmdb_data.get('rating', 0),
            'synopsis': tmdb_data.get('synopsis', ''),
            'seasons': tmdb_data.get('seasons', []),
        },
        'media_type': media_type,
        'groups': serialized_groups,
        'completeness': completeness,
        'total_results': len(results),
        'available_qualities': sorted(all_qualities, key=lambda x: QUALITY_RANK.get(x, 0), reverse=True),
        'available_languages': sorted(all_languages),
        'selected': [_serialize_result(s) for s in selected],
        'selected_count': len(selected),
    }


def _serialize_result(r):
    """Serialize a result for JSON response (strip internal fields)."""
    if not r:
        return None
    return {
        'chat_id': r.get('chat_id'),
        'message_id': r.get('message_id'),
        'file_name': r.get('file_name', ''),
        'file_size': r.get('file_size', 0),
        'file_size_human': r.get('file_size_human', ''),
        'quality': r.get('parsed_quality') or r.get('quality', 'unknown'),
        'languages': r.get('parsed_languages', []),
        'codec': r.get('parsed_codec', ''),
        'source': r.get('parsed_source', ''),
        'season': r.get('parsed_season'),
        'episode': r.get('parsed_episode'),
        'score': r.get('_score', 0),
        'relevance': r.get('_relevance', 0),
        'channel': r.get('channel', ''),
        'channel_title': r.get('channel_title', ''),
        'date': r.get('date', ''),
        'caption': r.get('caption', ''),
    }


async def forward_to_pipeline(selected_results, pull_fn, rate_limit=2.0):
    """
    Forward selected results to the ATMOS pipeline via pull_from_channel.
    
    Args:
        selected_results: List of serialized results to forward
        pull_fn: async callable(chat_id, message_id, file_name) -> dict
        rate_limit: Seconds between pulls to avoid Telegram flood
    
    Returns summary dict.
    """
    queued = 0
    errors = []
    total_size = 0

    for r in selected_results:
        try:
            if 'chat_id' not in r or not r['chat_id']:
                if 'magnet' in r:
                    raise ValueError("Cannot forward torrents/magnets automatically. Please copy the magnet link.")
                else:
                    raise ValueError("Missing chat_id/message_id (not a Telegram file)")
                    
            await pull_fn(
                int(r['chat_id']),
                int(r['message_id']),
                r.get('file_name', '')
            )
            queued += 1
            total_size += r.get('file_size', 0)
            # Rate limit to avoid Telegram flood
            if rate_limit > 0:
                await asyncio.sleep(rate_limit)
        except Exception as e:
            errors.append({
                'file_name': r.get('file_name', '?'),
                'error': str(e)[:200]
            })

    return {
        'queued': queued,
        'errors': errors,
        'total_files': len(selected_results),
        'total_size': total_size,
        'total_size_human': _human_size(total_size),
    }


def _human_size(b):
    """Format bytes into human-readable string."""
    if b < 1024:
        return f"{b} B"
    for unit in ['KB', 'MB', 'GB', 'TB']:
        b /= 1024
        if b < 1024:
            return f"{b:.1f} {unit}"
    return f"{b:.1f} PB"
