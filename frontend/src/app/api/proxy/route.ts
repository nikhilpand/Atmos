// ─── ATMOS V3.0 — Hardened Proxy ────────────────────────────────────
// Edge-runtime proxy with strict SSRF allowlist, origin allowlist.
// DNS-rebinding safe: uses hostname allowlist instead of IP regex.

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

// ─── Security: SSRF — Strict Hostname Allowlist ─────────────────────
// Only forward requests to these trusted upstream services.
// This prevents DNS-rebinding attacks that bypass IP regex checks.
const ALLOWED_PROXY_HOSTNAMES = new Set([
  // TMDB — all metadata, images
  'api.themoviedb.org',
  'image.tmdb.org',
  // Streaming embed providers
  'vidsrc.to',
  'vidsrc.icu',
  'vidsrc.cc',
  'embed.su',
  'autoembed.co',
  'player.videasy.net',
  'nontongo.win',
  // Torrent APIs
  'yts.mx',
  'eztvx.to',
  // Hugging Face spaces (meta/media/subs backends)
  'nikhil1776-atmos-meta.hf.space',
  'nikhil1776-atmos-media.hf.space',
  'nikhil1776-atmos-subs.hf.space',
  'nikhil1776-atmos-extractor.hf.space',
  'nikhil1776-gdrivefwd.hf.space',
  // @movie-web/providers targets
  'moviesapi.club',
  'vidplay.online',
  'fmoviesz.to',
  'rive.world',
  'vidcloud.lol',
]);

function isAllowedDestination(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Strict HTTPS only — never HTTP in production
    if (parsed.protocol !== 'https:') return false;
    // Allowlist check — exact hostname match
    if (ALLOWED_PROXY_HOSTNAMES.has(parsed.hostname)) return true;
    // Allow any *.hf.space subdomain (HF Spaces use dynamic names)
    if (parsed.hostname.endsWith('.hf.space')) return true;
    return false;
  } catch {
    return false;
  }
}

// ─── Header mapping ────────────────────────────────────────────────
const HEADER_MAP: Record<string, string> = {
  'x-cookie': 'cookie',
  'x-referer': 'referer',
  'x-origin': 'origin',
  'x-user-agent': 'user-agent',
  'x-real-ip': 'x-real-ip',
};

const RESPONSE_HEADER_MAP: Record<string, string> = {
  'set-cookie': 'x-set-cookie',
};

const STRIP_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding']);

const ALLOWED_ORIGINS = [
  'https://atmos.page.gd',
  'https://atmos-coral-sigma.vercel.app',
  'http://localhost:3000',
  'http://localhost:5500',
];

function getCorsOrigin(request: NextRequest): string {
  const origin = request.headers.get('origin') ?? '';
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  if (origin.startsWith('http://localhost:')) return origin;
  return ALLOWED_ORIGINS[0];
}

function corsHeaders(request: NextRequest): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': getCorsOrigin(request),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-cookie, x-referer, x-origin, x-user-agent, x-real-ip',
    'Access-Control-Expose-Headers': 'x-set-cookie, x-final-destination',
  };
}

// ─── Handlers ──────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  return handleProxy(request);
}

export async function POST(request: NextRequest) {
  return handleProxy(request);
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

async function handleProxy(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const destination = searchParams.get('destination');

  if (!destination) {
    return NextResponse.json({ error: 'Missing destination parameter' }, { status: 400 });
  }

  // SSRF Protection
  if (!isAllowedDestination(destination)) {
    return NextResponse.json({ error: 'Destination not allowed' }, { status: 403 });
  }

  // Build upstream headers
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    if (HEADER_MAP[lowerKey]) {
      headers.set(HEADER_MAP[lowerKey], value);
    } else if (!lowerKey.startsWith('x-') && lowerKey !== 'host' && lowerKey !== 'connection') {
      headers.set(lowerKey, value);
    }
  });

  try {
    let body: ArrayBuffer | undefined;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      body = await request.arrayBuffer();
    }

    const response = await fetch(destination, {
      method: request.method,
      headers,
      body,
      redirect: 'manual',
    });

    // Build response headers
    const responseHeaders = new Headers();
    response.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      if (RESPONSE_HEADER_MAP[lowerKey]) {
        responseHeaders.set(RESPONSE_HEADER_MAP[lowerKey], value);
      } else if (!STRIP_HEADERS.has(lowerKey)) {
        responseHeaders.set(lowerKey, value);
      }
    });

    // Capture redirects
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location) {
        responseHeaders.set('X-Final-Destination', location);
      }
    }

    // CORS headers
    const cors = corsHeaders(request);
    for (const [k, v] of Object.entries(cors)) {
      responseHeaders.set(k, v);
    }

    return new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Proxy request failed';
    console.error('[ATMOS:proxy] Error:', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
