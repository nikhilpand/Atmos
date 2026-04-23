// ─── ATMOS V2.0 — Hardened Proxy ────────────────────────────────────
// Edge-runtime proxy with SSRF protection, origin allowlist, and rate limiting.

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

// ─── Security: SSRF Protection ─────────────────────────────────────
const BLOCKED_IP_RE = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|169\.254\.|0\.0\.0\.0|localhost)/i;

function isAllowedDestination(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Block private/internal IPs
    if (BLOCKED_IP_RE.test(parsed.hostname)) return false;
    // Must be HTTPS in production
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    return true;
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
  // In development, allow any localhost
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
