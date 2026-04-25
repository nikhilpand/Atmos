// ─── ATMOS V3.0 — Multi-Source Stream Extraction Engine ─────────────
// Scrapes MULTIPLE provider APIs in parallel to find direct stream URLs
// for the download page. Falls back through multiple tiers.

import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 45;

const PROXY_URL = process.env.NEXT_PUBLIC_CF_PROXY_URL || '';

interface ExtractedStream {
  url: string;
  quality: string;
  type: 'hls' | 'mp4' | 'magnet' | 'torrent' | 'unknown';
  provider: string;
  size?: string;
  seeds?: number;
  peers?: number;
  captions: { language: string; url: string }[];
}

// ─── Helper: Proxy-aware fetch ──────────────────────────────────────
async function proxyFetch(url: string, timeout = 10000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    // Use Cloudflare proxy to avoid IP blocks from Vercel
    const fetchUrl = PROXY_URL 
      ? `${PROXY_URL}?destination=${encodeURIComponent(url)}`
      : url;
    const res = await fetch(fetchUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Referer': new URL(url).origin + '/',
      },
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Public Trackers for magnet links ────────────────────────────────
const TRACKERS = [
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.openbittorrent.com:80',
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://p4p.arenabg.com:1337',
  'udp://tracker.internetwarriors.net:1337/announce',
  'udp://9.rarbg.to:2710/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.moeking.me:6969/announce',
];

function buildMagnetLink(hash: string, title: string): string {
  const dn = encodeURIComponent(title);
  const trackerParams = TRACKERS.map(t => `&tr=${encodeURIComponent(t)}`).join('');
  return `magnet:?xt=urn:btih:${hash}&dn=${dn}${trackerParams}`;
}

// ─── TMDB → IMDB ID lookup (needed for torrent APIs) ────────────────
const imdbCache = new Map<string, string>();

async function getIMDBId(tmdbId: string, type: string): Promise<string | null> {
  const cacheKey = `${type}:${tmdbId}`;
  if (imdbCache.has(cacheKey)) return imdbCache.get(cacheKey)!;

  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/${type}/${tmdbId}/external_ids?api_key=${apiKey}`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const imdbId = data.imdb_id as string;
    if (imdbId) {
      imdbCache.set(cacheKey, imdbId);
      if (imdbCache.size > 500) {
        const keys = [...imdbCache.keys()];
        keys.slice(0, 100).forEach(k => imdbCache.delete(k));
      }
    }
    return imdbId || null;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// SOURCE 1: VidSrc.to API (returns direct stream URLs with qualities)
// ═══════════════════════════════════════════════════════════════════
async function scrapeVidsrcTo(tmdbId: string, type: string, season?: number, episode?: number): Promise<ExtractedStream[]> {
  try {
    const path = type === 'movie' 
      ? `/embed/movie/${tmdbId}`
      : `/embed/tv/${tmdbId}/${season}/${episode}`;
    
    const res = await proxyFetch(`https://vidsrc.to${path}`);
    const html = await res.text();
    
    // Extract data-id for the sources
    const sourceMatches = html.matchAll(/data-id="([^"]+)"/g);
    const streams: ExtractedStream[] = [];
    
    for (const match of sourceMatches) {
      try {
        const sourceRes = await proxyFetch(`https://vidsrc.to/ajax/embed/source/${match[1]}`);
        const sourceData = await sourceRes.json();
        if (sourceData?.result?.url) {
          streams.push({
            url: sourceData.result.url,
            quality: 'auto',
            type: sourceData.result.url.includes('.m3u8') ? 'hls' : 'mp4',
            provider: 'VidSrc.to',
            captions: [],
          });
        }
      } catch { /* skip bad source */ }
    }
    return streams;
  } catch(e) {
    log.warn('[ExtractAll] VidSrc.to failed', { error: String(e) });
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════
// SOURCE 2: Embed.su API (returns HLS streams with quality options)
// ═══════════════════════════════════════════════════════════════════
async function scrapeEmbedSu(tmdbId: string, type: string, season?: number, episode?: number): Promise<ExtractedStream[]> {
  try {
    const path = type === 'movie'
      ? `/embed/movie/${tmdbId}`
      : `/embed/tv/${tmdbId}/${season}/${episode}`;
    
    const res = await proxyFetch(`https://embed.su${path}`);
    const html = await res.text();
    
    // Look for encoded stream data in script tags
    const hashMatch = html.match(/atob\("([^"]+)"\)/);
    if (!hashMatch) return [];
    
    try {
      const decoded = Buffer.from(hashMatch[1], 'base64').toString();
      const data = JSON.parse(decoded);
      
      if (Array.isArray(data)) {
        return data
          .filter((s: { file?: string }) => s.file)
          .map((s: { file: string; label?: string }) => ({
            url: s.file,
            quality: s.label || 'auto',
            type: s.file.includes('.m3u8') ? 'hls' as const : 'mp4' as const,
            provider: 'Embed.su',
            captions: [],
          }));
      }
    } catch { /* decode failed */ }
    return [];
  } catch(e) {
    log.warn('[ExtractAll] Embed.su failed', { error: String(e) });
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════
// SOURCE 3: VidSrc.icu (returns M3U8 streams)
// ═══════════════════════════════════════════════════════════════════
async function scrapeVidsrcIcu(tmdbId: string, type: string, season?: number, episode?: number): Promise<ExtractedStream[]> {
  try {
    const path = type === 'movie'
      ? `/embed/movie/${tmdbId}`
      : `/embed/tv/${tmdbId}/${season}/${episode}`;
    
    const res = await proxyFetch(`https://vidsrc.icu${path}`);
    const html = await res.text();
    
    // Extract M3U8 URLs from the page
    const m3u8Matches = html.matchAll(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/g);
    const streams: ExtractedStream[] = [];
    const seen = new Set<string>();
    
    for (const match of m3u8Matches) {
      const url = match[0];
      if (!seen.has(url)) {
        seen.add(url);
        streams.push({
          url,
          quality: 'auto',
          type: 'hls',
          provider: 'VidSrc.icu',
          captions: [],
        });
      }
    }
    return streams;
  } catch(e) {
    log.warn('[ExtractAll] VidSrc.icu failed', { error: String(e) });
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════
// SOURCE 4: Autoembed API (JSON API returning stream URLs)
// ═══════════════════════════════════════════════════════════════════
async function scrapeAutoembed(tmdbId: string, type: string, season?: number, episode?: number): Promise<ExtractedStream[]> {
  try {
    const path = type === 'movie'
      ? `/api/getVideoSource?type=movie&id=${tmdbId}`
      : `/api/getVideoSource?type=tv&id=${tmdbId}&season=${season}&episode=${episode}`;
    
    const res = await proxyFetch(`https://autoembed.co${path}`);
    if (!res.ok) return [];
    const data = await res.json();
    
    const streams: ExtractedStream[] = [];
    if (data.videoSource) {
      streams.push({
        url: data.videoSource,
        quality: 'auto',
        type: data.videoSource.includes('.m3u8') ? 'hls' : 'mp4',
        provider: 'AutoEmbed',
        captions: (data.subtitles || []).map((s: { lang: string; url: string }) => ({ language: s.lang, url: s.url })),
      });
    }
    return streams;
  } catch(e) {
    log.warn('[ExtractAll] AutoEmbed failed', { error: String(e) });
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════
// SOURCE 5: Videasy API
// ═══════════════════════════════════════════════════════════════════
async function scrapeVideasy(tmdbId: string, type: string, season?: number, episode?: number): Promise<ExtractedStream[]> {
  try {
    const path = type === 'movie'
      ? `/${type}/${tmdbId}`
      : `/${type}/${tmdbId}/${season}/${episode}`;
    
    const res = await proxyFetch(`https://player.videasy.net${path}`);
    const html = await res.text();
    
    const streams: ExtractedStream[] = [];
    // Look for stream URLs in the page
    const urlMatches = html.matchAll(/(https?:\/\/[^\s"']+(?:\.m3u8|\.mp4)[^\s"']*)/g);
    const seen = new Set<string>();
    
    for (const match of urlMatches) {
      const url = match[1];
      if (!seen.has(url)) {
        seen.add(url);
        streams.push({
          url,
          quality: 'auto',
          type: url.includes('.m3u8') ? 'hls' : 'mp4',
          provider: 'Videasy',
          captions: [],
        });
      }
    }
    return streams;
  } catch(e) {
    log.warn('[ExtractAll] Videasy failed', { error: String(e) });
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════
// SOURCE 6: VidSrc.cc API (v2 API with direct links)
// ═══════════════════════════════════════════════════════════════════
async function scrapeVidsrcCc(tmdbId: string, type: string, season?: number, episode?: number): Promise<ExtractedStream[]> {
  try {
    const path = type === 'movie'
      ? `/v2/embed/movie/${tmdbId}`
      : `/v2/embed/tv/${tmdbId}/${season}/${episode}`;
    
    const res = await proxyFetch(`https://vidsrc.cc${path}`);
    const html = await res.text();
    
    const streams: ExtractedStream[] = [];
    const urlMatches = html.matchAll(/(https?:\/\/[^\s"']+(?:\.m3u8|\.mp4)[^\s"']*)/g);
    const seen = new Set<string>();
    
    for (const match of urlMatches) {
      const url = match[1];
      if (!seen.has(url)) {
        seen.add(url);
        streams.push({
          url,
          quality: 'auto',
          type: url.includes('.m3u8') ? 'hls' : 'mp4',
          provider: 'VidSrc.cc',
          captions: [],
        });
      }
    }
    return streams;
  } catch(e) {
    log.warn('[ExtractAll] VidSrc.cc failed', { error: String(e) });
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════
// SOURCE 7: @movie-web/providers (library extraction)
// ═══════════════════════════════════════════════════════════════════
async function scrapeMovieWeb(tmdbId: string, type: string, title: string, releaseYear: number, season?: number, episode?: number): Promise<ExtractedStream[]> {
  try {
    const { makeProviders, makeSimpleProxyFetcher, makeStandardFetcher, targets } = await import('@movie-web/providers');
    
    const providers = makeProviders({
      fetcher: PROXY_URL ? makeSimpleProxyFetcher(PROXY_URL, fetch) : makeStandardFetcher(fetch),
      target: targets.NATIVE,
    });

    const media = type === 'movie'
      ? { type: 'movie' as const, title, releaseYear, tmdbId }
      : {
          type: 'show' as const, title, releaseYear, tmdbId,
          season: { number: season ?? 1, tmdbId: '' },
          episode: { number: episode ?? 1, tmdbId: '' },
        };

    const output = await providers.runAll({ media });
    if (!output?.stream) return [];

    const stream = Array.isArray(output.stream) ? output.stream[0] : output.stream;
    const results: ExtractedStream[] = [];
    const s = stream as { playlist?: string; url?: string; qualities?: Record<string, { url?: string }>; captions?: { language: string; url: string }[] };
    const captions = (s.captions || []).map(c => ({ language: c.language, url: c.url }));

    if (s.playlist) results.push({ url: s.playlist, quality: 'auto', type: 'hls', provider: `MW:${output.sourceId}`, captions });
    if (s.url) results.push({ url: s.url, quality: 'auto', type: s.url.includes('.m3u8') ? 'hls' : 'mp4', provider: `MW:${output.sourceId}`, captions });
    if (s.qualities) {
      for (const [q, data] of Object.entries(s.qualities)) {
        if (data?.url) results.push({ url: data.url, quality: q.includes('p') ? q : q + 'p', type: data.url.includes('.m3u8') ? 'hls' : 'mp4', provider: `MW:${output.sourceId}`, captions });
      }
    }
    return results;
  } catch(e) {
    log.warn('[ExtractAll] MovieWeb failed', { error: String(e) });
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════
// SOURCE 8: NonTongo API
// ═══════════════════════════════════════════════════════════════════
async function scrapeNontongo(tmdbId: string, type: string, season?: number, episode?: number): Promise<ExtractedStream[]> {
  try {
    const path = type === 'movie'
      ? `/embed/movie/${tmdbId}`
      : `/embed/tv/${tmdbId}/${season}/${episode}`;
    
    const res = await proxyFetch(`https://nontongo.win${path}`);
    const html = await res.text();
    
    const streams: ExtractedStream[] = [];
    const urlMatches = html.matchAll(/(https?:\/\/[^\s"']+(?:\.m3u8|\.mp4)[^\s"']*)/g);
    const seen = new Set<string>();
    
    for (const match of urlMatches) {
      const url = match[1];
      if (!seen.has(url)) {
        seen.add(url);
        streams.push({
          url,
          quality: 'auto',
          type: url.includes('.m3u8') ? 'hls' : 'mp4',
          provider: 'NonTongo',
          captions: [],
        });
      }
    }
    return streams;
  } catch(e) {
    log.warn('[ExtractAll] NonTongo failed', { error: String(e) });
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════
// SOURCE 9: YTS Torrents (Movies — high quality with real sizes)
// ═══════════════════════════════════════════════════════════════════
async function scrapeYTS(tmdbId: string, title: string): Promise<ExtractedStream[]> {
  try {
    const imdbId = await getIMDBId(tmdbId, 'movie');
    if (!imdbId) {
      log.warn('[ExtractAll] YTS: No IMDB ID for', { tmdbId });
      return [];
    }

    // YTS supports query by IMDB ID
    const res = await proxyFetch(
      `https://yts.mx/api/v2/list_movies.json?query_term=${imdbId}&limit=1`,
      12000
    );
    if (!res.ok) return [];
    const data = await res.json();

    const movies = data?.data?.movies;
    if (!movies || movies.length === 0) return [];

    const movie = movies[0];
    const streams: ExtractedStream[] = [];

    for (const torrent of movie.torrents || []) {
      if (!torrent.hash) continue;
      const magnetUrl = buildMagnetLink(torrent.hash, `${movie.title_long || title}`);
      streams.push({
        url: magnetUrl,
        quality: torrent.quality || 'unknown',
        type: 'magnet',
        provider: 'YTS',
        size: torrent.size || undefined,
        seeds: torrent.seeds || 0,
        peers: torrent.peers || 0,
        captions: [],
      });
    }

    return streams;
  } catch (e) {
    log.warn('[ExtractAll] YTS failed', { error: String(e) });
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════
// SOURCE 10: EZTV Torrents (TV Shows — by IMDB ID)
// ═══════════════════════════════════════════════════════════════════
async function scrapeEZTV(tmdbId: string, season?: number, episode?: number): Promise<ExtractedStream[]> {
  try {
    const imdbId = await getIMDBId(tmdbId, 'tv');
    if (!imdbId) {
      log.warn('[ExtractAll] EZTV: No IMDB ID for', { tmdbId });
      return [];
    }

    // EZTV uses numeric IMDB ID (without 'tt' prefix)
    const numericImdb = imdbId.replace('tt', '');
    const res = await proxyFetch(
      `https://eztvx.to/api/get-torrents?imdb_id=${numericImdb}&limit=100`,
      12000
    );
    if (!res.ok) return [];
    const data = await res.json();

    const torrents = data?.torrents;
    if (!torrents || torrents.length === 0) return [];

    const streams: ExtractedStream[] = [];
    const targetSeason = season ?? 1;
    const targetEpisode = episode ?? 1;

    for (const t of torrents) {
      // Filter to matching season/episode
      if (t.season !== undefined && t.episode !== undefined) {
        if (Number(t.season) !== targetSeason || Number(t.episode) !== targetEpisode) continue;
      } else {
        // Try to parse from title: S01E01 format
        const seMatch = t.title?.match(/S(\d{1,2})E(\d{1,2})/i);
        if (seMatch) {
          const s = parseInt(seMatch[1]);
          const e = parseInt(seMatch[2]);
          if (s !== targetSeason || e !== targetEpisode) continue;
        } else {
          continue; // Can't determine season/episode, skip
        }
      }

      if (!t.hash) continue;
      const magnetUrl = buildMagnetLink(t.hash, t.title || `S${targetSeason}E${targetEpisode}`);

      // Determine quality from filename
      let quality = 'unknown';
      const titleLower = (t.title || '').toLowerCase();
      if (titleLower.includes('2160p') || titleLower.includes('4k')) quality = '2160p';
      else if (titleLower.includes('1080p')) quality = '1080p';
      else if (titleLower.includes('720p')) quality = '720p';
      else if (titleLower.includes('480p')) quality = '480p';

      const sizeMB = t.size_bytes ? Math.round(t.size_bytes / (1024 * 1024)) : undefined;
      const sizeStr = sizeMB ? (sizeMB >= 1024 ? `${(sizeMB / 1024).toFixed(1)} GB` : `${sizeMB} MB`) : undefined;

      streams.push({
        url: magnetUrl,
        quality,
        type: 'magnet',
        provider: 'EZTV',
        size: sizeStr,
        seeds: t.seeds || 0,
        peers: t.peers || 0,
        captions: [],
      });
    }

    return streams;
  } catch (e) {
    log.warn('[ExtractAll] EZTV failed', { error: String(e) });
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════
// MAIN HANDLER: Run ALL sources in parallel
// ═══════════════════════════════════════════════════════════════════
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tmdbId, type, title, releaseYear, season, episode } = body;

    if (!tmdbId || !type || !title) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    log.info('[ExtractAll] Starting multi-source extraction', { tmdbId, type, title, season, episode });

    // Run ALL scrapers in parallel with individual timeouts
    const results = await Promise.allSettled([
      scrapeMovieWeb(tmdbId, type, title, releaseYear ?? new Date().getFullYear(), season, episode),
      scrapeVidsrcTo(tmdbId, type, season, episode),
      scrapeVidsrcIcu(tmdbId, type, season, episode),
      scrapeVidsrcCc(tmdbId, type, season, episode),
      scrapeEmbedSu(tmdbId, type, season, episode),
      scrapeAutoembed(tmdbId, type, season, episode),
      scrapeVideasy(tmdbId, type, season, episode),
      scrapeNontongo(tmdbId, type, season, episode),
      // Torrent sources
      type === 'movie' ? scrapeYTS(tmdbId, title) : Promise.resolve([]),
      type === 'tv' ? scrapeEZTV(tmdbId, season, episode) : Promise.resolve([]),
    ]);

    // Collect all successful streams
    const allStreams: ExtractedStream[] = [];
    const seen = new Set<string>();

    for (const result of results) {
      if (result.status === 'fulfilled') {
        for (const stream of result.value) {
          // Deduplicate by URL
          if (!seen.has(stream.url)) {
            seen.add(stream.url);
            allStreams.push(stream);
          }
        }
      }
    }

    // Sort: Torrent/Magnet first (real downloads), then MP4, then HLS
    const typeOrder: Record<string, number> = { 'magnet': 0, 'torrent': 1, 'mp4': 2, 'hls': 3, 'unknown': 4 };
    const qualityOrder: Record<string, number> = { '2160p': 0, '1080p': 1, '720p': 2, '480p': 3, '360p': 4, 'auto': 5, 'unknown': 6 };
    allStreams.sort((a, b) => {
      // Type priority: magnet > mp4 > hls
      const typeDiff = (typeOrder[a.type] ?? 99) - (typeOrder[b.type] ?? 99);
      if (typeDiff !== 0) return typeDiff;
      // Higher quality first
      const qualDiff = (qualityOrder[a.quality] ?? 99) - (qualityOrder[b.quality] ?? 99);
      if (qualDiff !== 0) return qualDiff;
      // More seeds first (for torrents)
      return (b.seeds ?? 0) - (a.seeds ?? 0);
    });

    const sourcesChecked = results.length;
    const sourcesFailed = results.filter(r => r.status === 'rejected').length;

    log.info('[ExtractAll] Complete', { 
      tmdbId, streams: allStreams.length, sourcesChecked, sourcesFailed,
      providers: [...new Set(allStreams.map(s => s.provider))],
    });

    return NextResponse.json({
      streams: allStreams,
      title,
      tmdbId,
      type,
      season: season ?? null,
      episode: episode ?? null,
      meta: { sourcesChecked, sourcesFailed, timestamp: new Date().toISOString() },
    });
  } catch (error) {
    log.error('[ExtractAll] Fatal error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ streams: [], error: 'Extraction failed' }, { status: 502 });
  }
}
