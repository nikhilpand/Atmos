# 01 — Security Audit & Hardening

## 🔴 CRITICAL-1: Admin Password in Client-Reachable Bundle

**File:** `src/lib/constants.ts` — line 82  
**OWASP:** A02 Cryptographic Failures / A05 Security Misconfiguration

```ts
// ❌ BEFORE — hardcoded fallback, imported by client files
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '1908';
```

```ts
// ✅ AFTER — server-only, never exported to client
// constants.server.ts  (new file, never import in "use client")
export function getAdminPassword(): string {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) throw new Error('ADMIN_PASSWORD env var not set');
  return pw;
}
```

**Fix steps:**
1. Create `src/lib/constants.server.ts` with server-only secrets
2. Add `import 'server-only'` at top of that file (Next.js guard)
3. Delete `ADMIN_PASSWORD` from `constants.ts`
4. Update every admin API route to import from `constants.server.ts`

---

## 🔴 CRITICAL-2: Open Proxy — SSRF Attack Surface

**File:** `src/app/api/proxy/route.ts` — line 38–65  
**OWASP:** A10 SSRF

The proxy accepts **any** `destination` URL with zero validation. An attacker can:
- Hit internal Vercel infrastructure (`169.254.x.x`)
- Probe private HuggingFace space admin endpoints
- Exfiltrate environment variables via metadata endpoints

```ts
// ❌ BEFORE — no URL validation
const destination = searchParams.get('destination');
if (!destination) { return error 400 }
// immediately fetches destination
```

```ts
// ✅ AFTER — allowlist validation
const ALLOWED_ORIGINS = [
  'https://nikhil1776-atmos-meta.hf.space',
  'https://nikhil1776-atmos-subs.hf.space',
  'https://nikhil1776-atmos-media.hf.space',
  'https://nikhil1776-gdrivefwd.hf.space',
];

function isAllowedDestination(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Block private IP ranges
    if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|169\.254\.)/.test(parsed.hostname)) return false;
    return ALLOWED_ORIGINS.some(o => url.startsWith(o));
  } catch { return false; }
}

if (!isAllowedDestination(destination)) {
  return NextResponse.json({ error: 'Destination not allowed' }, { status: 403 });
}
```

---

## 🔴 CRITICAL-3: TMDB API Key Exposed to Client

**File:** `src/lib/constants.ts` — line 11  
**OWASP:** A02 Cryptographic Failures

```ts
// ❌ BEFORE — NEXT_PUBLIC_ prefix sends key to browser bundle
export const TMDB_API_KEY = process.env.TMDB_API_KEY || process.env.NEXT_PUBLIC_TMDB_API_KEY || '';
```

```ts
// ✅ AFTER — server-only, never NEXT_PUBLIC_
// In constants.server.ts
export const TMDB_API_KEY = process.env.TMDB_API_KEY ?? '';
// In title/route.ts — already server-side, just remove NEXT_PUBLIC_ fallback
```

**Action:** Audit all `NEXT_PUBLIC_` vars — only URLs that need client-side access should be public.

---

## 🟡 MAJOR-1: Wildcard CORS on Proxy

**File:** `src/app/api/proxy/route.ts` — line 29, 82–85

```ts
// ❌ BEFORE
'Access-Control-Allow-Origin': '*',
'Access-Control-Allow-Headers': '*',
```

```ts
// ✅ AFTER
const ALLOWED_REFERERS = ['https://your-domain.vercel.app', 'http://localhost:3000'];

function getCorsOrigin(request: NextRequest): string {
  const origin = request.headers.get('origin') ?? '';
  return ALLOWED_REFERERS.includes(origin) ? origin : ALLOWED_REFERERS[0];
}
// Then:
responseHeaders.set('Access-Control-Allow-Origin', getCorsOrigin(request));
responseHeaders.set('Access-Control-Allow-Headers', 'content-type, x-cookie, x-referer, x-origin, x-user-agent');
```

---

## 🟡 MAJOR-2: No Rate Limiting on Any API Route

**All API routes** — zero rate limiting means:
- Proxy can be abused as a free fetch relay
- `/api/resolve` can spam the HuggingFace subs server
- `/api/title` can exhaust TMDB API quota

**Fix:** Use Vercel's built-in rate limiting middleware OR add a lightweight token bucket:

```ts
// middleware.ts
import { NextRequest, NextResponse } from 'next/server';

const rateMap = new Map<string, { count: number; reset: number }>();

export function middleware(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith('/api/proxy')) return;
  
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  const now = Date.now();
  const entry = rateMap.get(ip);

  if (entry && now < entry.reset) {
    if (entry.count >= 60) { // 60 req/min
      return new NextResponse('Too Many Requests', { status: 429 });
    }
    entry.count++;
  } else {
    rateMap.set(ip, { count: 1, reset: now + 60_000 });
  }
}

export const config = { matcher: '/api/:path*' };
```

---

## 🟡 MAJOR-3: `window.open` Monkey-Patching

**File:** `StreamPlayer.tsx` — lines 122–129  

Globally overriding `window.open` can break legitimate popups (OAuth flows, payment widgets) and is fragile. The override persists until component unmounts — but multiple IframePlayer mounts/unmounts could stack these.

```ts
// ❌ BEFORE — global mutation
window.open = function(...args) { return null; };

// ✅ AFTER — use sandbox attribute on iframe instead (no JS needed)
<iframe
  sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
  // Note: omitting "allow-popups" blocks popups at browser level
/>
```

---

## Checklist
- [ ] Move `ADMIN_PASSWORD` to `constants.server.ts` with `import 'server-only'`
- [ ] Add SSRF allowlist to `/api/proxy/route.ts`
- [ ] Remove `NEXT_PUBLIC_TMDB_API_KEY` fallback
- [ ] Restrict CORS to known origins
- [ ] Add `middleware.ts` rate limiting
- [ ] Replace `window.open` override with iframe `sandbox` attribute
