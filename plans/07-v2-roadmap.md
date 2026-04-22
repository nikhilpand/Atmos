# 07 — V2.0 Architecture Roadmap

## Feature 1: Server-Side Stream Extraction (Reliability++)

**Current:** `@movie-web/providers` runs in the browser — blocked by CSP, browser fingerprinting, captchas.

**V2:** Move to server-side extraction in `/api/extract/route.ts` using the `nodejs` runtime.

```
Browser → POST /api/extract { tmdbId, type, season, episode }
        → Server runs @movie-web/providers (no CORS, no fingerprinting)
        → Returns { url, quality, subtitles[] }
        → Browser plays via NativeVideoPlayer
```

**Benefits:**
- No provider detection of browser automation
- Extraction happens once, URL shared via cache to all users
- Can add Redis cache — extraction result shared across all concurrent viewers

```ts
// src/app/api/extract/route.ts
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { tmdbId, type, season, episode } = await req.json();
  
  // Check Redis cache first
  const cacheKey = `extract:${tmdbId}:${type}:${season}:${episode}`;
  const cached = await redis.get(cacheKey);
  if (cached) return NextResponse.json(JSON.parse(cached));

  const result = await extractStreamServer({ tmdbId, type, season, episode });
  if (result?.url) {
    await redis.setex(cacheKey, 1800, JSON.stringify(result)); // 30min TTL
  }
  return NextResponse.json(result ?? { url: null });
}
```

---

## Feature 2: Real Observability Stack

**Current:** `console.error()` calls scattered with no correlation IDs, no tracing.

**V2:** Structured logging + OpenTelemetry traces.

```ts
// src/lib/telemetry.ts
import { trace, context, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('atmos-v2');

export async function withSpan<T>(
  name: string,
  fn: () => Promise<T>,
  attributes?: Record<string, string>
): Promise<T> {
  const span = tracer.startSpan(name, { attributes });
  try {
    const result = await context.with(trace.setSpan(context.active(), span), fn);
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (err) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
    span.recordException(err as Error);
    throw err;
  } finally {
    span.end();
  }
}

// Usage in resolve/route.ts
const healthData = await withSpan('fetch-health-data', 
  () => fetchHealthData(tmdbId, type),
  { tmdbId, type }
);
```

**Stack recommendation:**
- **Traces:** Vercel's built-in OTEL or Axiom
- **Logs:** Axiom / Logtail (structured JSON)
- **Errors:** Sentry (`@sentry/nextjs`)
- **Uptime:** Better Uptime or Checkly

---

## Feature 3: Edge-Cached Subtitle Proxy

**Current:** Subtitles fetched from `SUBS_URL` with no CDN caching.

**V2:** Add a subtitle proxy with Vercel Edge Cache:

```ts
// src/app/api/subtitles/route.ts
export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tmdbId = searchParams.get('id');
  const lang = searchParams.get('lang') ?? 'en';

  const res = await fetch(`${SUBS_URL}/subtitles?tmdb_id=${tmdbId}&lang=${lang}`, {
    next: { revalidate: 3600 }, // 1h edge cache
  });

  return new NextResponse(res.body, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
```

---

## Feature 4: User Watch Progress (Supabase Realtime)

**Current:** No watch progress tracking. User must manually navigate back to where they stopped.

**V2:** Track progress server-side with optimistic local updates.

```ts
// src/lib/useWatchProgress.ts
export function useWatchProgress(tmdbId: string, episodeKey: string) {
  const save = useDebouncedCallback(async (progress: number) => {
    // Optimistic local save
    localStorage.setItem(`progress:${tmdbId}:${episodeKey}`, String(progress));
    // Background sync to Supabase
    await supabase.from('watch_progress').upsert({
      tmdb_id: tmdbId, episode_key: episodeKey,
      progress_seconds: progress, updated_at: new Date().toISOString(),
    });
  }, 5000); // debounce 5s

  const load = async () => {
    const local = localStorage.getItem(`progress:${tmdbId}:${episodeKey}`);
    if (local) return parseFloat(local);
    const { data } = await supabase.from('watch_progress')
      .select('progress_seconds').eq('tmdb_id', tmdbId).eq('episode_key', episodeKey).single();
    return data?.progress_seconds ?? 0;
  };

  return { save, load };
}
```

---

## Feature 5: CI/CD + Testing Strategy

**Current:** No test files found. No CI/CD configuration detected.

### Testing Pyramid

```
e2e/                          ← Playwright tests (smoke: can play a stream?)
  watch.spec.ts
  provider-fallback.spec.ts
  
src/__tests__/
  lib/
    computeSmartScore.test.ts ← Unit: scoring algorithm
    extractStreamUrl.test.ts  ← Unit: stream URL extraction
    makeTTLCache.test.ts      ← Unit: cache utility
  api/
    resolve.test.ts           ← Integration: full resolve flow
    title.test.ts             ← Integration: all 3 fallback strategies
```

### GitHub Actions Workflow

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run type-check    # tsc --noEmit
      - run: npm run lint           # eslint
      - run: npm test               # jest
      - run: npm run build          # ensure build succeeds
```

### Recommended Library Replacements

| Current | Replacement | Reason |
|---------|-------------|--------|
| Custom `fetchWithRetry` | `ky` (tiny) or keep + fix | Better timeout + retry ergonomics |
| Module-level Map cache | `@vercel/kv` (Upstash Redis) | Shared across serverless instances |
| `console.error` logging | `axiom-node` | Structured, searchable, alertable |
| No testing | `vitest` + `@testing-library/react` | ESM native, fast, matches Jest API |
| No error tracking | `@sentry/nextjs` | Automatic source maps, session replay |

---

## 30-Day V2 Execution Plan

| Week | Focus | Outcome |
|------|-------|---------|
| 1 | Security fixes (plan 01) + Error handling (plan 03) | No critical vulns |
| 2 | Architecture refactor (plan 04) + Dead code cleanup (plan 06) | Maintainable codebase |
| 3 | Performance (plan 02) + Observability (Feature 2) | Production-grade reliability |
| 4 | Server-side extraction (Feature 1) + CI/CD (Feature 5) | Automated quality gates |
