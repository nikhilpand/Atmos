// ─── ATMOS V3.0 — Multi-Source Stream Extraction ────────────────────
// Runs @movie-web/providers and returns ALL available streams from
// ALL sources, with quality tiers, for the download page.

import { NextRequest, NextResponse } from 'next/server';
import { makeProviders, makeStandardFetcher, makeSimpleProxyFetcher, targets } from '@movie-web/providers';
import { log } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 30;

const PROXY_URL = process.env.NEXT_PUBLIC_CF_PROXY_URL;

const serverProviders = makeProviders({
  fetcher: PROXY_URL ? makeSimpleProxyFetcher(PROXY_URL, fetch) : makeStandardFetcher(fetch),
  target: targets.NATIVE,
});

interface StreamQuality {
  url?: string;
}

interface StreamOutput {
  playlist?: string;
  url?: string;
  qualities?: Record<string, StreamQuality>;
  type?: string;
  captions?: { language: string; url: string; type: string }[];
}

interface ExtractedStream {
  url: string;
  quality: string;
  type: 'hls' | 'mp4' | 'unknown';
  provider: string;
  captions: { language: string; url: string }[];
}

function extractAllStreams(stream: unknown, sourceId: string): ExtractedStream[] {
  if (!stream || typeof stream !== 'object') return [];
  const s = stream as StreamOutput;
  const results: ExtractedStream[] = [];
  const captions = (s.captions || []).map(c => ({ language: c.language, url: c.url }));

  // HLS playlist (auto quality — player handles resolution switching)
  if (typeof s.playlist === 'string' && s.playlist) {
    results.push({
      url: s.playlist,
      quality: 'auto',
      type: 'hls',
      provider: sourceId,
      captions,
    });
  }

  // Direct URL
  if (typeof s.url === 'string' && s.url) {
    results.push({
      url: s.url,
      quality: 'auto',
      type: s.url.includes('.m3u8') ? 'hls' : 'mp4',
      provider: sourceId,
      captions,
    });
  }

  // Individual quality tiers
  if (s.qualities && typeof s.qualities === 'object') {
    for (const [q, data] of Object.entries(s.qualities)) {
      if (data?.url) {
        results.push({
          url: data.url,
          quality: q.includes('p') ? q : q + 'p',
          type: data.url.includes('.m3u8') ? 'hls' : 'mp4',
          provider: sourceId,
          captions,
        });
      }
    }
  }

  return results;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tmdbId, type, title, releaseYear, season, episode } = body;

    if (!tmdbId || !type || !title) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

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

    log.info('[ExtractAll] Running multi-source extraction', { tmdbId, type, title, season, episode });

    const output = await serverProviders.runAll({ media });
    const allStreams: ExtractedStream[] = [];

    if (output?.stream) {
      const stream = Array.isArray(output.stream) ? output.stream[0] : output.stream;
      const streams = extractAllStreams(stream, output.sourceId ?? 'unknown');
      allStreams.push(...streams);
    }

    log.info('[ExtractAll] Found streams', { count: allStreams.length, tmdbId });

    return NextResponse.json({
      streams: allStreams,
      title,
      tmdbId,
      type,
      season: season ?? null,
      episode: episode ?? null,
    });
  } catch (error) {
    log.error('[ExtractAll] Fatal error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ streams: [], error: 'Extraction failed' }, { status: 502 });
  }
}
