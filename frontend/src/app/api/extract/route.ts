// ═══════════════════════════════════════════════════════════════════════
// ATMOS V2.0 — Server-Side Stream Extraction Engine
// ═══════════════════════════════════════════════════════════════════════
// Uses @movie-web/providers to extract raw m3u8/mp4 URLs server-side.
// Returns direct stream links that can be played in our native player
// or used for downloading.
//
// Error Handling:
//   - 15s hard timeout on the entire extraction
//   - Individual provider failures are swallowed; best result wins
//   - Falls back gracefully with structured error responses
//   - Rate-limited to prevent abuse (in-memory, per-IP)
// ═══════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import {
  makeProviders,
  makeStandardFetcher,
  targets,
  type RunOutput,
  type ScrapeMedia,
  type FullScraperEvents,
} from '@movie-web/providers';
import { TMDB_BASE, TMDB_API_KEY } from '@/lib/constants';

export const runtime = 'nodejs';
export const maxDuration = 20; // Vercel function timeout

// ─── Module-level caches ─────────────────────────────────────────────
const extractionCache = new Map<
  string,
  { result: ExtractedStream; timestamp: number }
>();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes (stream URLs expire)
const MAX_CACHE_SIZE = 200;

// ─── Rate limiting (simple in-memory) ────────────────────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const RATE_LIMIT_MAX = 15; // 15 extractions per minute per IP

// ─── Types ───────────────────────────────────────────────────────────
interface ExtractedStream {
  type: 'hls' | 'file';
  url: string;
  quality?: string;
  qualities?: Record<string, string>;
  headers?: Record<string, string>;
  captions?: Array<{ language: string; url: string; type: string }>;
  sourceId?: string;
  embedId?: string;
}

interface ExtractionResponse {
  success: boolean;
  stream?: ExtractedStream;
  error?: string;
  fromCache?: boolean;
  extractionTimeMs?: number;
  providersChecked?: number;
}

// ─── TMDB metadata fetch (for title + year) ──────────────────────────
const tmdbMetaCache = new Map<string, { title: string; year: number; tmdbId: string; seasonTmdbId?: string; episodeTmdbId?: string }>();

async function getTMDBMeta(
  tmdbId: string,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<{ title: string; year: number; seasonTmdbId?: string; episodeTmdbId?: string } | null> {
  const cacheKey = `${tmdbId}:${type}:${season}:${episode}`;
  const cached = tmdbMetaCache.get(cacheKey);
  if (cached) return cached;

  const apiKey = TMDB_API_KEY || process.env.TMDB_API_KEY;
  if (!apiKey) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);

    const url = `${TMDB_BASE}/${type}/${tmdbId}?api_key=${apiKey}&language=en-US`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) return null;
    const data = await res.json();

    const result: { title: string; year: number; seasonTmdbId?: string; episodeTmdbId?: string } = {
      title: data.title || data.name || '',
      year: parseInt((data.release_date || data.first_air_date || '0').slice(0, 4)),
    };

    // For TV shows, we need season and episode TMDB IDs
    if (type === 'tv' && season && episode) {
      try {
        const seasonUrl = `${TMDB_BASE}/tv/${tmdbId}/season/${season}?api_key=${apiKey}`;
        const seasonRes = await fetch(seasonUrl);
        if (seasonRes.ok) {
          const seasonData = await seasonRes.json();
          result.seasonTmdbId = String(seasonData.id || '');
          const ep = seasonData.episodes?.find((e: { episode_number: number }) => e.episode_number === episode);
          if (ep) result.episodeTmdbId = String(ep.id || '');
        }
      } catch {
        // Season/episode lookup failed — we'll use empty strings
      }
    }

    tmdbMetaCache.set(cacheKey, { ...result, tmdbId });
    if (tmdbMetaCache.size > 500) {
      const keys = [...tmdbMetaCache.keys()];
      keys.slice(0, 100).forEach(k => tmdbMetaCache.delete(k));
    }

    return result;
  } catch {
    return null;
  }
}

// ─── Rate limit check ────────────────────────────────────────────────
function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN EXTRACTION HANDLER
// ═══════════════════════════════════════════════════════════════════════
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const { searchParams } = new URL(request.url);

  const tmdbId = searchParams.get('id');
  const type = (searchParams.get('type') || 'movie') as 'movie' | 'tv';
  const season = searchParams.get('season') ? parseInt(searchParams.get('season')!) : undefined;
  const episode = searchParams.get('episode') ? parseInt(searchParams.get('episode')!) : undefined;

  // ── Validation ──
  if (!tmdbId) {
    return NextResponse.json<ExtractionResponse>(
      { success: false, error: 'Missing id parameter' },
      { status: 400 }
    );
  }

  if (type === 'tv' && (!season || !episode)) {
    return NextResponse.json<ExtractionResponse>(
      { success: false, error: 'TV shows require season and episode parameters' },
      { status: 400 }
    );
  }

  // ── Rate limiting ──
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkRateLimit(clientIp)) {
    return NextResponse.json<ExtractionResponse>(
      { success: false, error: 'Rate limit exceeded. Try again in a minute.' },
      { status: 429 }
    );
  }

  // ── Cache check ──
  const cacheKey = `${tmdbId}-${type}-${season ?? 0}-${episode ?? 0}`;
  const cached = extractionCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json<ExtractionResponse>({
      success: true,
      stream: cached.result,
      fromCache: true,
      extractionTimeMs: Date.now() - startTime,
    });
  }

  // ── Fetch TMDB metadata (title + year required by providers) ──
  const meta = await getTMDBMeta(tmdbId, type, season, episode);
  if (!meta || !meta.title) {
    return NextResponse.json<ExtractionResponse>(
      { success: false, error: 'Could not fetch title metadata from TMDB' },
      { status: 404 }
    );
  }

  // ── Build media object ──
  let media: ScrapeMedia;
  if (type === 'movie') {
    media = {
      type: 'movie',
      title: meta.title,
      releaseYear: meta.year,
      tmdbId: tmdbId,
    };
  } else {
    media = {
      type: 'show',
      title: meta.title,
      releaseYear: meta.year,
      tmdbId: tmdbId,
      season: {
        number: season!,
        tmdbId: meta.seasonTmdbId || '',
      },
      episode: {
        number: episode!,
        tmdbId: meta.episodeTmdbId || '',
      },
    };
  }

  // ── Initialize provider engine ──
  let providerEngine;
  try {
    providerEngine = makeProviders({
      fetcher: makeStandardFetcher(fetch),
      target: targets.ANY,
    });
  } catch (err) {
    console.error('[EXTRACT] Failed to initialize provider engine:', err);
    return NextResponse.json<ExtractionResponse>(
      { success: false, error: 'Internal: Provider engine initialization failed' },
      { status: 500 }
    );
  }

  // ── Run extraction with hard timeout ──
  let result: RunOutput | null = null;
  let providersChecked = 0;

  const events: FullScraperEvents = {
    start: () => { providersChecked++; },
    update: (evt) => {
      if (evt.status === 'failure') {
        console.warn(`[EXTRACT] Provider ${evt.id} failed:`, evt.reason || 'unknown');
      }
    },
  };

  try {
    const extractionPromise = providerEngine.runAll({
      media,
      events,
    });

    // 15s hard timeout
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), 15_000);
    });

    result = await Promise.race([extractionPromise, timeoutPromise]);
  } catch (err) {
    console.error('[EXTRACT] Extraction threw:', err);
    return NextResponse.json<ExtractionResponse>(
      { success: false, error: 'Extraction failed — all providers errored', providersChecked },
      { status: 502 }
    );
  }

  if (!result || !result.stream) {
    return NextResponse.json<ExtractionResponse>(
      { success: false, error: 'No streams found from any provider', providersChecked },
      { status: 404 }
    );
  }

  // ── Build response ──
  const stream = result.stream;
  let extractedStream: ExtractedStream;

  if (stream.type === 'hls') {
    extractedStream = {
      type: 'hls',
      url: stream.playlist,
      headers: stream.headers || stream.preferredHeaders,
      captions: stream.captions?.map(c => ({
        language: c.language,
        url: c.url,
        type: c.type,
      })),
      sourceId: result.sourceId,
      embedId: result.embedId,
    };
  } else if (stream.type === 'file') {
    // File-based: pick best quality
    const qualityOrder: Array<'4k' | '1080' | '720' | '480' | '360' | 'unknown'> = ['4k', '1080', '720', '480', '360', 'unknown'];
    let bestUrl = '';
    let bestQuality = '';
    const allQualities: Record<string, string> = {};

    for (const q of qualityOrder) {
      const file = stream.qualities[q];
      if (file?.url) {
        allQualities[q] = file.url;
        if (!bestUrl) {
          bestUrl = file.url;
          bestQuality = q;
        }
      }
    }

    if (!bestUrl) {
      return NextResponse.json<ExtractionResponse>(
        { success: false, error: 'Stream found but no playable quality available', providersChecked },
        { status: 404 }
      );
    }

    extractedStream = {
      type: 'file',
      url: bestUrl,
      quality: bestQuality,
      qualities: allQualities,
      headers: stream.headers || stream.preferredHeaders,
      captions: stream.captions?.map(c => ({
        language: c.language,
        url: c.url,
        type: c.type,
      })),
      sourceId: result.sourceId,
      embedId: result.embedId,
    };
  } else {
    return NextResponse.json<ExtractionResponse>(
      { success: false, error: 'Unknown stream type returned', providersChecked },
      { status: 500 }
    );
  }

  // ── Cache the result ──
  extractionCache.set(cacheKey, { result: extractedStream, timestamp: Date.now() });
  if (extractionCache.size > MAX_CACHE_SIZE) {
    const sorted = [...extractionCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
    sorted.slice(0, 50).forEach(([k]) => extractionCache.delete(k));
  }

  return NextResponse.json<ExtractionResponse>({
    success: true,
    stream: extractedStream,
    fromCache: false,
    extractionTimeMs: Date.now() - startTime,
    providersChecked,
  });
}
