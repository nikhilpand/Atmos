import re
import json

def parse_filename(filename):
    original = filename
    # Strip extension
    name = filename.rsplit('.', 1)[0] if '.' in filename else filename
    
    # 1. Clean up garbage brackets and tags (e.g. [720p], [TIF], @apple)
    # Remove resolution/codec info
    name = re.sub(r'(?i)[\[\(]?(720p|1080p|2160p|4k|8k|x264|x265|hevc|10bit|webrip|web-dl|bluray)[\]\)]?', ' ', name)
    # Remove bracketed junk at the start like [TIF] or [Subs]
    name = re.sub(r'^\[.*?\]\s*', '', name)
    # Remove uploader tags like @apple or movies101
    name = re.sub(r'@[^\s]+', '', name)
    name = re.sub(r'(?i)movies101', '', name)
    
    # Replace dots and underscores with spaces
    name = name.replace('.', ' ').replace('_', ' ')
    
    # 2. Extract TV pattern
    # Pattern 1: S05 E12 or S05E12 or S05_E12
    tv_match = re.search(r'(?i)S(\d+)\s*E(\d+)', name)
    if not tv_match:
        # Pattern 2: 1x02 or 01x02
        tv_match = re.search(r'(?i)\b(\d+)x(\d+)\b', name)
        
    if tv_match:
        season = int(tv_match.group(1))
        episode = int(tv_match.group(2))
        
        # The show name is usually whatever precedes the season/episode pattern
        # or we might need to be smart if the pattern is at the START like [TIF]_S06_E10_Game_Of_Thrones
        # If the pattern is at the start, the title is after it.
        match_start = tv_match.start()
        
        if match_start < 5: # The pattern is at the very beginning of the string (after we stripped [TIF])
            # Title is after
            raw_title = name[tv_match.end():]
        else:
            # Title is before
            raw_title = name[:match_start]
            
        clean_title = re.sub(r'\s+', ' ', raw_title).strip('- ')
        return {
            "type": "show",
            "title": clean_title,
            "season": season,
            "episode": episode
        }
        
    # 3. Anime absolute numbering fallback
    # Look for "Ep 145", "Episode 145" or just standalone 3 digit numbers with typical anime bracket tags
    # Since we stripped the brackets, let's look for "Episode X" or "Ep X"
    anime_match = re.search(r'(?i)(?:episode|ep)\s*(\d+)', name)
    if anime_match:
        episode = int(anime_match.group(1))
        raw_title = name[:anime_match.start()]
        clean_title = re.sub(r'\s+', ' ', raw_title).strip('- ')
        return {
            "type": "anime",
            "title": clean_title,
            "season": 1, # default season 1 for absolute
            "episode": episode
        }
        
    # 4. Fallback to Movie
    # Extract year if present
    year_match = re.search(r'\b(19\d{2}|20\d{2})\b', name)
    year = None
    if year_match:
        year = int(year_match.group(1))
        name = name[:year_match.start()]
        
    clean_title = re.sub(r'\s+', ' ', name).strip('- ')
    return {
        "type": "movie",
        "title": clean_title,
        "year": year
    }

test_cases = [
    "Breaking bad S05 E12 -  [720p] @apple movies101",
    "[TIF]_S06_E10_Game_Of_Thrones_720p_10bit.mkv",
    "Naruto Episode 145 [1080p].mp4",
    "Avatar.The.Way.Of.Water.2022.2160p.HDR.mp4",
    "The.Last.of.Us.S01E03.1080p.WEBRip.x264-AMZN.mkv",
    "Peacemaker.1x04.1080p.WEB.H264-CAKES.mkv"
]

for t in test_cases:
    res = parse_filename(t)
    print(f"[{t}]\n => {json.dumps(res)}\n")
