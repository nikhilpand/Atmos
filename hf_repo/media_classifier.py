"""
Media Classifier V2 — Ultra High-End Telegram Filename Parser.
Extracts: title, season, episode, year, quality, language, codec, audio info.
Handles all common Telegram naming patterns including season packs, 
multi-episode ranges, dual audio, and bracketed metadata.
"""
import re
import os


class MediaClassifier:
    """Parses messy Telegram filenames into structured metadata."""

    # Quality detection patterns (ordered by priority)
    QUALITY_PATTERNS = [
        (r'\b2160p\b|\b4K\b|\bUHD\b', '2160p'),
        (r'\b1080p\b', '1080p'),
        (r'\b720p\b', '720p'),
        (r'\b480p\b', '480p'),
        (r'\b360p\b', '360p'),
    ]

    # Language detection patterns
    LANGUAGE_PATTERNS = [
        (r'\b(?:dual[\s._-]*audio|DUAL)\b', 'Dual Audio'),
        (r'\b(?:multi[\s._-]*(?:audio|lang))\b', 'Multi'),
        (r'\bHindi\b', 'Hindi'),
        (r'\bEnglish\b', 'English'),
        (r'\bTamil\b', 'Tamil'),
        (r'\bTelugu\b', 'Telugu'),
        (r'\bKorean\b', 'Korean'),
        (r'\bJapanese\b', 'Japanese'),
        (r'\bSpanish\b', 'Spanish'),
        (r'\bFrench\b', 'French'),
    ]

    # Codec detection patterns
    CODEC_PATTERNS = [
        (r'\b(?:x265|H[\s.]?265|HEVC)\b', 'HEVC'),
        (r'\b(?:x264|H[\s.]?264|AVC)\b', 'AVC'),
        (r'\bAV1\b', 'AV1'),
        (r'\bVP9\b', 'VP9'),
    ]

    # Source detection
    SOURCE_PATTERNS = [
        (r'\bWEB[\s._-]*DL\b', 'WEB-DL'),
        (r'\bWEBRip\b', 'WEBRip'),
        (r'\bBlu[\s._-]*Ray\b', 'BluRay'),
        (r'\bBDRip\b', 'BDRip'),
        (r'\bHDRip\b', 'HDRip'),
        (r'\bCAMRip\b', 'CAMRip'),
        (r'\bDVDRip\b', 'DVDRip'),
        (r'\bAMZN\b', 'AMZN'),
        (r'\bNF\b|\bNetflix\b', 'Netflix'),
        (r'\bDSNP\b|\bDisney\+?\b', 'Disney+'),
        (r'\bHMAX\b|\bHBO\b', 'HBO Max'),
        (r'\bJioCinema\b', 'JioCinema'),
    ]

    @staticmethod
    def _detect_pattern(text, patterns):
        """Detect first matching pattern from a list."""
        for pattern, label in patterns:
            if re.search(pattern, text, flags=re.IGNORECASE):
                return label
        return None

    @staticmethod
    def _detect_all_patterns(text, patterns):
        """Detect all matching patterns from a list."""
        results = []
        for pattern, label in patterns:
            if re.search(pattern, text, flags=re.IGNORECASE):
                results.append(label)
        return results

    @classmethod
    def parse(cls, filename):
        """
        Parse a Telegram filename into structured metadata.
        
        Returns dict:
        {
            "type": "show" | "movie" | "anime",
            "title": str,
            "season": int (optional),
            "episode": int (optional),
            "episode_end": int (optional — for multi-episode ranges),
            "year": int (optional),
            "quality": str (optional — "1080p", "720p", etc.),
            "languages": list[str] (optional),
            "codec": str (optional — "HEVC", "AVC", etc.),
            "source": str (optional — "WEB-DL", "BluRay", etc.),
            "is_season_pack": bool
        }
        """
        original = filename
        # Strip extension
        name = filename.rsplit('.', 1)[0] if '.' in filename else filename

        # ── Extract metadata BEFORE cleaning ──
        quality = cls._detect_pattern(original, cls.QUALITY_PATTERNS)
        languages = cls._detect_all_patterns(original, cls.LANGUAGE_PATTERNS)
        codec = cls._detect_pattern(original, cls.CODEC_PATTERNS)
        source = cls._detect_pattern(original, cls.SOURCE_PATTERNS)

        # ── Check for season pack (COMPLETE/FULL SEASON) ──
        is_season_pack = bool(re.search(
            r'\b(?:COMPLETE|FULL[\s._-]*SEASON|S\d+[\s._-]*COMPLETE)\b', name, flags=re.IGNORECASE
        ))

        # ── Clean up garbage brackets and tags ──
        # Remove resolution, codecs, container info
        name = re.sub(r'[\[(\s_.-]?(720p|1080p|2160p|4k|8k|x264|x265|hevc|10bit|'
                      r'webrip|web-dl|bluray|amzn|nf|netflix|hmax|dsnp|avc|av1|'
                      r'dual[\s._-]*audio|multi|complete|aac|dts|atmos|flac|'
                      r'esub|esubs|hdr|hdr10|dv|dolby[\s._-]*vision|'
                      r'ddp?\d*|DD\+?\d*|5\.1|7\.1|remux)[\])\s_.-]?', ' ', name, flags=re.IGNORECASE)
        # Remove bracketed junk at the start like [TIF] or [SubsPlease]
        name = re.sub(r'^\[.*?\]\s*', '', name)
        # Remove uploader tags
        name = re.sub(r'@[\w.]+', '', name)
        name = re.sub(r'movies101|pahe\.in|rarbg|yts|mkvcinemas', '', name, flags=re.IGNORECASE)
        # Remove dash-separated uploader at end: "- MoviesCo" or "- [uploader]"
        name = re.sub(r'\s*-\s*\[?\w+\]?\s*$', '', name)

        # Replace dots and underscores with spaces
        name = name.replace('.', ' ').replace('_', ' ')

        # ── 1. Extract TV pattern: S05E12 or S05 E12 ──
        tv_match = re.search(r'S(\d+)\s*E(\d+)', name, flags=re.IGNORECASE)
        
        # ── 1b. Multi-episode: S01E01-E08 or S01E01-08 ──
        multi_ep = re.search(r'S(\d+)\s*E(\d+)\s*[-–]\s*E?(\d+)', name, flags=re.IGNORECASE)
        
        # ── 1c. Season-only: S01 (for season packs) ──
        season_only = None
        if not tv_match and not multi_ep:
            season_only = re.search(r'\bS(\d+)\b', name, flags=re.IGNORECASE)
        
        if not tv_match and not multi_ep and not season_only:
            # Pattern 2: 1x02 or 01x02
            tv_match = re.search(r'\b(\d+)x(\d+)\b', name, flags=re.IGNORECASE)

        if multi_ep:
            season = int(multi_ep.group(1))
            episode = int(multi_ep.group(2))
            episode_end = int(multi_ep.group(3))
            match_start = multi_ep.start()
            raw_title = name[:match_start] if match_start >= 5 else name[multi_ep.end():]
            clean_title = re.sub(r'\s+', ' ', raw_title).strip('- ')
            return {
                "type": "show",
                "title": clean_title,
                "season": season,
                "episode": episode,
                "episode_end": episode_end,
                "year": cls._extract_year(name[:match_start] if match_start >= 5 else ""),
                "quality": quality,
                "languages": languages,
                "codec": codec,
                "source": source,
                "is_season_pack": False,
            }

        if tv_match:
            season = int(tv_match.group(1))
            episode = int(tv_match.group(2))
            match_start = tv_match.start()
            if match_start < 5:
                raw_title = name[tv_match.end():]
            else:
                raw_title = name[:match_start]
            clean_title = re.sub(r'\s+', ' ', raw_title).strip('- ')
            return {
                "type": "show",
                "title": clean_title,
                "season": season,
                "episode": episode,
                "year": cls._extract_year(name[:match_start] if match_start >= 5 else ""),
                "quality": quality,
                "languages": languages,
                "codec": codec,
                "source": source,
                "is_season_pack": False,
            }

        if season_only and is_season_pack:
            season = int(season_only.group(1))
            match_start = season_only.start()
            raw_title = name[:match_start] if match_start >= 3 else name[season_only.end():]
            clean_title = re.sub(r'\s+', ' ', raw_title).strip('- ')
            return {
                "type": "show",
                "title": clean_title,
                "season": season,
                "episode": 0,
                "year": cls._extract_year(raw_title),
                "quality": quality,
                "languages": languages,
                "codec": codec,
                "source": source,
                "is_season_pack": True,
            }

        # ── 2. Anime absolute numbering: "Episode 145" or "Ep 145" ──
        anime_match = re.search(r'(?:episode|ep)\s*(\d+)', name, flags=re.IGNORECASE)
        if anime_match:
            episode = int(anime_match.group(1))
            raw_title = name[:anime_match.start()]
            clean_title = re.sub(r'\s+', ' ', raw_title).strip('- ')
            return {
                "type": "anime",
                "title": clean_title,
                "season": 1,
                "episode": episode,
                "year": cls._extract_year(raw_title),
                "quality": quality,
                "languages": languages,
                "codec": codec,
                "source": source,
                "is_season_pack": False,
            }

        # ── 3. Fallback to Movie ──
        year = cls._extract_year(name)
        if year:
            year_match = re.search(r'\b' + str(year) + r'\b', name)
            if year_match:
                name = name[:year_match.start()]

        clean_title = re.sub(r'\s+', ' ', name).strip('- ')
        return {
            "type": "movie",
            "title": clean_title,
            "year": year,
            "quality": quality,
            "languages": languages,
            "codec": codec,
            "source": source,
            "is_season_pack": False,
        }

    @staticmethod
    def _extract_year(text):
        """Extract a plausible release year from text."""
        match = re.search(r'\b((?:19|20)\d{2})\b', text)
        if match:
            year = int(match.group(1))
            if 1920 <= year <= 2030:
                return year
        return None

    @staticmethod
    def generate_gdrive_path(parsed_data, include_season=True):
        """
        Generates a hierarchical folder path array for Google Drive.
        e.g., ["TV Shows", "Breaking Bad", "Season 5"]
        """
        if parsed_data["type"] in ("show", "anime"):
            title = parsed_data["title"] or "Unknown Show"
            path = ["TV Shows", title]
            if include_season and parsed_data.get("season") is not None:
                path.append(f"Season {parsed_data['season']}")
            return path
        else:
            return ["Movies"]
