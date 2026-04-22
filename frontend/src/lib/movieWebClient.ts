// ─── ATMOS V2.0 — Stream Extraction Client (Typed) ──────────────────
// Uses @movie-web/providers for client-side HLS extraction.
// Fully typed — no `any` casts.

import { makeProviders, makeSimpleProxyFetcher, targets } from '@movie-web/providers';
import { log } from '@/lib/logger';

const PROXY_URL = '/api/proxy';

const providers = makeProviders({
  fetcher: makeSimpleProxyFetcher(PROXY_URL, fetch),
  target: targets.BROWSER,
});

// ─── Types ──────────────────────────────────────────────────────────
export interface MediaDetails {
  type: 'movie' | 'tv';
  title: string;
  releaseYear: number;
  tmdbId: string;
  season?: number;
  episode?: number;
}

interface MovieMedia {
  type: 'movie';
  title: string;
  releaseYear: number;
  tmdbId: string;
}

interface ShowMedia {
  type: 'show';
  title: string;
  releaseYear: number;
  tmdbId: string;
  season: { number: number; tmdbId: string };
  episode: { number: number; tmdbId: string };
}

type ProviderMedia = MovieMedia | ShowMedia;

interface StreamQuality {
  url?: string;
}

interface StreamOutput {
  playlist?: string;
  url?: string;
  qualities?: Record<string, StreamQuality>;
}

// ─── Safe URL extractor ─────────────────────────────────────────────
function extractStreamUrl(stream: unknown): string | null {
  if (!stream || typeof stream !== 'object') return null;
  const s = stream as StreamOutput;

  if (typeof s.playlist === 'string' && s.playlist) return s.playlist;
  if (typeof s.url === 'string' && s.url) return s.url;

  if (s.qualities && typeof s.qualities === 'object') {
    // Prefer auto quality, then first available
    const autoUrl = s.qualities['auto']?.url;
    if (autoUrl) return autoUrl;

    const firstQuality = Object.values(s.qualities)[0];
    if (firstQuality?.url) return firstQuality.url;
  }

  return null;
}

// ─── Main extraction function ───────────────────────────────────────
export async function extractStreamClient(
  mediaDetails: MediaDetails
): Promise<string | null> {
  const media: ProviderMedia =
    mediaDetails.type === 'movie'
      ? {
          type: 'movie',
          title: mediaDetails.title,
          releaseYear: mediaDetails.releaseYear,
          tmdbId: mediaDetails.tmdbId,
        }
      : {
          type: 'show',
          title: mediaDetails.title,
          releaseYear: mediaDetails.releaseYear,
          tmdbId: mediaDetails.tmdbId,
          season: { number: mediaDetails.season ?? 1, tmdbId: '' },
          episode: { number: mediaDetails.episode ?? 1, tmdbId: '' },
        };

  try {
    const output = await providers.runAll({ media });

    if (output?.stream) {
      const stream = Array.isArray(output.stream)
        ? output.stream[0]
        : output.stream;
      const url = extractStreamUrl(stream);
      if (url) {
        log.info('[Extract] Stream found', {
          title: mediaDetails.title,
          type: mediaDetails.type,
        });
        return url;
      }
    }
  } catch (error) {
    log.error('[Extract] Extraction failed', {
      title: mediaDetails.title,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return null;
}
