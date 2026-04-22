# 03 — Error Handling & Null Safety

## 🟡 MAJOR-1: Swallowed Errors with Empty Catch Blocks

Multiple files swallow errors silently, making production debugging impossible.

**Files & lines:**
- `title/route.ts` lines 29, 47, 61, 112 — `catch { /* timeout */ }`
- `resolve/route.ts` line 152 — `catch { // Supabase unavailable }`
- `proxy/route.ts` line 93 — logs then swallows

```ts
// ❌ BEFORE — silent swallow
} catch { /* timeout */ }

// ✅ AFTER — structured logging with context
} catch (err) {
  console.error('[ATMOS:title] TMDB fetch failed', {
    path, 
    error: err instanceof Error ? err.message : String(err),
    timestamp: new Date().toISOString(),
  });
}
```

**Create a shared logger:**
```ts
// src/lib/logger.ts
type LogLevel = 'info' | 'warn' | 'error';

export function log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  const entry = { level, message, ...meta, ts: new Date().toISOString() };
  if (level === 'error') console.error(JSON.stringify(entry));
  else if (level === 'warn') console.warn(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}
```

---

## 🟡 MAJOR-2: `any` Type Used Throughout — No Runtime Safety

**Files:** `title/route.ts` (eslint-disable at line 1), `movieWebClient.ts` (line 24, 47)

```ts
// ❌ BEFORE
const media: any = mediaDetails.type === 'movie' ? { ... } : { ... };
const streamUrl = (stream as any)?.playlist || (stream as any)?.url || ...
```

```ts
// ✅ AFTER — define proper types
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

// For stream output — use type guard
function extractStreamUrl(stream: unknown): string | null {
  if (!stream || typeof stream !== 'object') return null;
  const s = stream as Record<string, unknown>;
  if (typeof s.playlist === 'string') return s.playlist;
  if (typeof s.url === 'string') return s.url;
  const qualities = s.qualities as Record<string, { url?: string }> | undefined;
  if (qualities) {
    return qualities['auto']?.url ?? Object.values(qualities)[0]?.url ?? null;
  }
  return null;
}
```

---

## 🟡 MAJOR-3: Error Response Returns HTTP 200 for Failures

**File:** `title/route.ts` — line 344

```ts
// ❌ BEFORE — error returns 200, React Query treats it as success
return NextResponse.json({ error: 'Failed to fetch...', detail: {...} }, { status: 200 });
```

This means `useQuery` never enters the `isError` state — the UI silently shows broken data.

```ts
// ✅ AFTER — return proper status codes
// Partial data (some fields missing) → 206
// Total failure → 500 or 502
return NextResponse.json(
  { error: 'Upstream fetch failed', detail: fallback },
  { status: 502 }
);

// In the client query — add error boundary:
const { data, isError } = useQuery({ queryKey: [...], queryFn: fetchTitle });
if (isError) return <ErrorScreen />;
```

---

## 🟡 MAJOR-4: `reportHealth` Fire-and-Forget with No Error Handling

**File:** `StreamPlayer.tsx` — lines 131–138

```ts
// ❌ BEFORE
const reportHealth = (success: boolean) => {
  fetch(`${SUBS_URL}/provider-report`, { ... }).catch(() => {});
};
```

The `.catch(() => {})` is a code smell — it means if the subs server is down, health data silently degrades without any visibility.

```ts
// ✅ AFTER — fire-and-forget with observability
const reportHealth = useCallback((success: boolean) => {
  if (!tmdbId || !activeProviderId) return;
  fetch(`${SUBS_URL}/provider-report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tmdb_id: tmdbId, type: mediaType, provider_id: activeProviderId, success }),
  }).catch((err) => {
    // Non-critical but log for observability
    console.warn('[ATMOS:health] Provider report failed', err?.message);
  });
}, [tmdbId, activeProviderId, mediaType]);
```

---

## 🟢 MINOR-1: Non-null Assertion `!` Used on Possibly-Null Values

**File:** `resolve/route.ts` — line 79

```ts
// ❌ BEFORE
responseHeaders.set('X-Final-Destination', response.headers.get('location')!);
```

```ts
// ✅ AFTER
const location = response.headers.get('location');
if (location) responseHeaders.set('X-Final-Destination', location);
```

---

## 🟢 MINOR-2: `parseInt` Without Radix

**File:** `title/route.ts` — lines 315, 339

```ts
// ❌ BEFORE
id: parseInt(id) || 0,

// ✅ AFTER
id: parseInt(id, 10) || 0,
```

---

## 🟢 MINOR-3: `hasError` Stale Closure in `handleIframeLoad`

**File:** `StreamPlayer.tsx` — lines 152–159

```ts
// ❌ BEFORE — `hasError` captured at closure creation time
const handleIframeLoad = () => {
  setIsLoading(false);
  setHasError(false);
  setTimeout(() => {
    if (!hasError) reportHealth(true); // stale closure!
  }, 5000);
};
```

```ts
// ✅ AFTER — use ref to read latest value
const hasErrorRef = useRef(false);
// sync ref with state:
useEffect(() => { hasErrorRef.current = hasError; }, [hasError]);

const handleIframeLoad = useCallback(() => {
  setIsLoading(false);
  setHasError(false);
  const timer = setTimeout(() => {
    if (!hasErrorRef.current) reportHealth(true);
  }, 5000);
  return () => clearTimeout(timer); // can't return cleanup from event handler — store in ref
}, [reportHealth]);
```

---

## Checklist
- [ ] Create `src/lib/logger.ts` shared structured logger
- [ ] Replace all empty `catch {}` blocks with structured logging
- [ ] Remove `/* eslint-disable @typescript-eslint/no-explicit-any */` from `title/route.ts`
- [ ] Type `MediaDetails` union in `movieWebClient.ts`
- [ ] Add `extractStreamUrl()` type-safe helper
- [ ] Fix error HTTP status in `title/route.ts` line 344
- [ ] Add radix to all `parseInt` calls
- [ ] Fix stale closure in `handleIframeLoad`
