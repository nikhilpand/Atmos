// ─── ATMOS V2.0 — Server-Side Stream Extraction ────────────────────
// Runs @movie-web/providers on the server for better reliability.
// No CORS issues, no browser fingerprint detection, cached results.

import { NextRequest, NextResponse } from 'next/server';
import { makeProviders, makeStandardFetcher, makeSimpleProxyFetcher, targets } from '@movie-web/providers';
import { createTTLCache } from '@/lib/cache';
import { log } from '@/lib/logger';

// Node.js runtime needed for @movie-web/providers
export const runtime = 'nodejs';

// ─── Server-side provider instance ─────────────────────────────────
const PROXY_URL = process.env.NEXT_PUBLIC_CF_PROXY_URL;

const serverProviders = makeProviders({
  // Use CF Proxy if available to bypass Vercel datacenter IP blocks, else direct fetch
  fetcher: PROXY_URL ? makeSimpleProxyFetcher(PROXY_URL, fetch) : makeStandardFetcher(fetch),
  target: targets.NATIVE,
});

// Cache extraction results for 30 minutes
const extractCache = createTTLCache<ExtractResult>(30 * 60 * 1000, 200);

interface ExtractResult {
  url: string | null;
  quality?: string;
  provider?: string;
  extractedAt: string;
}

interface StreamQuality {
  url?: string;
}

interface StreamOutput {
  playlist?: string;
  url?: string;
  qualities?: Record<string, StreamQuality>;
}

function extractUrl(stream: unknown): { url: string | null; quality: string } {
  if (!stream || typeof stream !== 'object') return { url: null, quality: 'unknown' };
  const s = stream as StreamOutput;

  if (typeof s.playlist === 'string' && s.playlist) return { url: s.playlist, quality: 'auto' };
  if (typeof s.url === 'string' && s.url) return { url: s.url, quality: 'auto' };

  if (s.qualities && typeof s.qualities === 'object') {
    // Try quality tiers: 1080, 720, 480, auto, then first available
    for (const q of ['1080', '720', '480', 'auto']) {
      if (s.qualities[q]?.url) return { url: s.qualities[q].url!, quality: q + 'p' };
    }
    const first = Object.entries(s.qualities)[0];
    if (first?.[1]?.url) return { url: first[1].url, quality: first[0] };
  }

  return { url: null, quality: 'unknown' };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tmdbId, type, title, releaseYear, season, episode } = body;

    if (!tmdbId || !type || !title) {
      return NextResponse.json({ error: 'Missing required fields: tmdbId, type, title' }, { status: 400 });
    }

    // Cache lookup
    const cacheKey = `${tmdbId}:${type}:${season ?? 0}:${episode ?? 0}`;
    const cached = extractCache.get(cacheKey);
    if (cached) {
      log.info('[Extract:Server] Cache hit', { tmdbId, cacheKey });
      return NextResponse.json({ ...cached, fromCache: true });
    }

    // Build media object
    const media = type === 'movie'
      ? { type: 'movie' as const, title, releaseYear: releaseYear ?? new Date().getFullYear(), tmdbId }
      : {
          type: 'show' as const,
          title,
          releaseYear: releaseYear ?? new Date().getFullYear(),
          tmdbId,
          season: { number: season ?? 1, tmdbId: '' },
          episode: { number: episode ?? 1, tmdbId: '' },
        };

    log.info('[Extract:Server] Running extraction', { tmdbId, type, title });

    const output = await serverProviders.runAll({ media });

    if (output?.stream) {
      const stream = Array.isArray(output.stream) ? output.stream[0] : output.stream;
      const { url, quality } = extractUrl(stream);

      const result: ExtractResult = {
        url,
        quality,
        provider: output.sourceId ?? undefined,
        extractedAt: new Date().toISOString(),
      };

      if (url) {
        extractCache.set(cacheKey, result);
        log.info('[Extract:Server] Success', { tmdbId, quality, provider: result.provider });
      }

      return NextResponse.json({ ...result, fromCache: false });
    }

    log.warn('[Extract:Server] No stream found', { tmdbId, type });
    return NextResponse.json({ url: null, quality: null, fromCache: false });
  } catch (error) {
    log.error('[Extract:Server] Fatal error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ url: null, error: 'Extraction failed' }, { status: 502 });
  }
}
