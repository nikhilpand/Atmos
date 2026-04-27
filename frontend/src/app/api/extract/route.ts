// ═══════════════════════════════════════════════════════════════════════
// ATMOS V3.0 — Headless Browser Stream Extraction Engine
// ═══════════════════════════════════════════════════════════════════════
// Delegates extraction to atmos-extractor HF Space which runs real
// Playwright Chromium to intercept .m3u8/.mp4 URLs that streaming
// providers hide behind obfuscated JS.
//
// Architecture:
//   1. Build embed URL for each provider (vidsrc.icu, 8stream, etc.)
//   2. POST to atmos-extractor microservice (HF Space)
//   3. Service runs headless Chromium, executes provider's JS naturally
//   4. Intercepts real m3u8/mp4 network request
//   5. Returns URL + headers → plays in NativePlayer with full control
// ═══════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { TMDB_BASE, TMDB_API_KEY } from '@/lib/constants';

export const runtime = 'nodejs';
export const maxDuration = 30;

// ─── Extractor microservice URL ───────────────────────────────────────
// Points to the atmos-extractor Hugging Face Space
const EXTRACTOR_BASE = process.env.NEXT_PUBLIC_EXTRACTOR_URL
  || 'https://nkp9450732628-atmos-extractor.hf.space';

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
  provider?: string;
  providerName?: string;
}

interface ExtractionResponse {
  success: boolean;
  stream?: ExtractedStream;
  error?: string;
  fromCache?: boolean;
  extractionTimeMs?: number;
  providersChecked?: number;
}

// ─── Module-level cache ───────────────────────────────────────────────
const extractionCache = new Map<string, { result: ExtractedStream; timestamp: number }>();
const CACHE_TTL = 25 * 60 * 1000; // 25 minutes
const MAX_CACHE_SIZE = 200;

// ─── Rate limiting ────────────────────────────────────────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60_000;
const RATE_LIMIT_MAX = 20;

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

// ─── TMDB metadata fetch ──────────────────────────────────────────────
const tmdbMetaCache = new Map<string, { title: string; year: number }>();

async function getTMDBMeta(
  tmdbId: string,
  type: 'movie' | 'tv',
): Promise<{ title: string; year: number } | null> {
  const cacheKey = `${tmdbId}:${type}`;
  const cached = tmdbMetaCache.get(cacheKey);
  if (cached) return cached;

  const apiKey = TMDB_API_KEY || process.env.TMDB_API_KEY;
  if (!apiKey) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const url = `${TMDB_BASE}/${type}/${tmdbId}?api_key=${apiKey}&language=en-US`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const result = {
      title: data.title || data.name || '',
      year: parseInt((data.release_date || data.first_air_date || '0').slice(0, 4)),
    };
    tmdbMetaCache.set(cacheKey, result);
    if (tmdbMetaCache.size > 500) {
      const keys = [...tmdbMetaCache.keys()];
      keys.slice(0, 100).forEach(k => tmdbMetaCache.delete(k));
    }
    return result;
  } catch {
    return null;
  }
}

// ─── Call the Playwright extractor microservice ───────────────────────
async function callExtractor(
  tmdbId: string,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number,
): Promise<ExtractedStream | null> {
  const params = new URLSearchParams({
    id: tmdbId,
    type,
    ...(season ? { season: String(season) } : {}),
    ...(episode ? { episode: String(episode) } : {}),
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 28_000); // 28s total

  try {
    const res = await fetch(`${EXTRACTOR_BASE}/extract/tmdb?${params}`, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Atmos/3.0',
      },
    });
    clearTimeout(timer);

    if (!res.ok) return null;
    const data = await res.json();

    if (!data.success || !data.stream?.url) return null;

    return {
      type: data.stream.type === 'hls' ? 'hls' : 'file',
      url: data.stream.url,
      headers: data.stream.headers || {},
      provider: data.stream.provider,
      providerName: data.stream.providerName,
    };
  } catch (err) {
    clearTimeout(timer);
    console.error('[EXTRACT V3] Extractor call failed:', err);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const { searchParams } = new URL(request.url);

  const tmdbId = searchParams.get('id');
  const type = (searchParams.get('type') || 'movie') as 'movie' | 'tv';
  const season = searchParams.get('season') ? parseInt(searchParams.get('season')!) : undefined;
  const episode = searchParams.get('episode') ? parseInt(searchParams.get('episode')!) : undefined;

  if (!tmdbId) {
    return NextResponse.json<ExtractionResponse>(
      { success: false, error: 'Missing id parameter' },
      { status: 400 },
    );
  }

  if (type === 'tv' && (!season || !episode)) {
    return NextResponse.json<ExtractionResponse>(
      { success: false, error: 'TV shows require season and episode' },
      { status: 400 },
    );
  }

  // Rate limit
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkRateLimit(clientIp)) {
    return NextResponse.json<ExtractionResponse>(
      { success: false, error: 'Rate limit exceeded' },
      { status: 429 },
    );
  }

  // Cache check
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

  // Call headless browser extractor
  const stream = await callExtractor(tmdbId, type, season, episode);

  if (!stream) {
    return NextResponse.json<ExtractionResponse>(
      {
        success: false,
        error: 'No streams found — extractor microservice unavailable or all providers blocked',
      },
      { status: 404 },
    );
  }

  // Cache result
  extractionCache.set(cacheKey, { result: stream, timestamp: Date.now() });
  if (extractionCache.size > MAX_CACHE_SIZE) {
    const sorted = [...extractionCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
    sorted.slice(0, 50).forEach(([k]) => extractionCache.delete(k));
  }

  return NextResponse.json<ExtractionResponse>({
    success: true,
    stream,
    fromCache: false,
    extractionTimeMs: Date.now() - startTime,
  });
}
