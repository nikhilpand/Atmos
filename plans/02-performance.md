# 02 — Performance Analysis & Caching

## 🔴 CRITICAL: In-Memory Cache on Edge Runtime (Silent Failure)

**File:** `src/app/api/title/route.ts` — lines 10, 16–17

The file declares `export const runtime = 'edge'` but uses a module-level `Map` as a cache.

**The problem:** Edge functions are stateless and may run in multiple V8 isolates simultaneously. The `titleCache` Map is **not shared** across instances — it silently fills up per-isolate and never actually serves cached data across users. The 24-hour TTL is a false promise.

```ts
// ❌ BEFORE
export const runtime = 'edge';
const titleCache = new Map<string, { data: any; timestamp: number }>();
```

```ts
// ✅ OPTION A: Switch to nodejs runtime (shares memory on same instance)
export const runtime = 'nodejs';

// ✅ OPTION B (preferred for scale): Use Next.js Data Cache
const res = await fetch(url, {
  next: { revalidate: 86400 }, // 24h ISR cache — works on edge + serverless
});

// ✅ OPTION C (best): KV store (Vercel KV / Upstash Redis)
import { kv } from '@vercel/kv';
const cached = await kv.get<TitleData>(cacheKey);
```

**Recommendation:** Use `next: { revalidate }` on every TMDB fetch call — it hooks into Next.js's shared data cache and works across all runtimes.

---

## 🟡 MAJOR-1: Waterfall Fetches in Stream Extraction

**File:** `StreamPlayer.tsx` — lines 264–288 (the `extract()` function)

The extraction flow is sequential:
1. `fetch('/api/title')` → wait
2. Parse title from response → wait  
3. `extractStreamClient(mediaDetails)` → wait (can take 5–15s)

Meanwhile the user sees a spinner. There's no timeout, no abort, no parallel optimization.

```ts
// ✅ AFTER — add AbortController with timeout
async function extract() {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
    if (isMounted) setHlsFailed(true);
  }, 15_000); // 15s hard timeout

  try {
    const titleRes = await fetch(
      `/api/title?id=${tmdbId}&type=${mediaType || 'movie'}`,
      { signal: controller.signal }
    );
    // ...rest of logic
  } finally {
    clearTimeout(timeout);
  }
}
```

---

## 🟡 MAJOR-2: streamCache Eviction is O(n log n) per Request

**File:** `src/app/api/resolve/route.ts` — lines 244–247

```ts
// ❌ BEFORE — sorts entire cache to evict 100 entries
if (streamCache.size > 500) {
  const sorted = [...streamCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
  sorted.slice(0, 100).forEach(([k]) => streamCache.delete(k));
}
```

At 500 entries, this is fine. But it runs **on every cache miss** (after every set). Better: use an LRU pattern.

```ts
// ✅ AFTER — O(1) eviction with capped Map (insertion-order)
const MAX_CACHE = 500;
function setCacheEntry(key: string, value: CacheEntry) {
  if (streamCache.size >= MAX_CACHE) {
    // Map preserves insertion order — first key is oldest
    const firstKey = streamCache.keys().next().value;
    if (firstKey) streamCache.delete(firstKey);
  }
  streamCache.set(key, value);
}
```

---

## 🟡 MAJOR-3: `fetchWithRetry` Passes `next: { revalidate: 300 }` Everywhere

**File:** `src/lib/api.ts` — line 94

```ts
const res = await fetch(url, { ...options, next: { revalidate: 300 } });
```

This forces a 5-minute cache on **all** fetches including stream resolution calls where stale data is actively harmful. The revalidation time should be per-endpoint, not global.

```ts
// ✅ AFTER — caller controls revalidation
async function fetchWithRetry(
  url: string,
  options?: RequestInit & { revalidate?: number },
  retries = 1
): Promise<Response> {
  const { revalidate = 0, ...rest } = options ?? {};
  const fetchOptions = revalidate > 0 
    ? { ...rest, next: { revalidate } } 
    : rest;
  // ...
}

// Usage
await fetchWithRetry(url, { revalidate: 86400 }); // title — 24h
await fetchWithRetry(url, { revalidate: 0 });       // stream — no cache
```

---

## 🟢 MINOR-1: Unnecessary `setTimeout(() => {}, 0)` Patterns

**File:** `watch/[id]/page.tsx` — lines 80, 95–98, 102

```ts
// ❌ BEFORE — setTimeout(fn, 0) used to defer state updates
setTimeout(() => setActiveProviderId(providers[0].id), 0);
setTimeout(() => { setFailedProviders(new Set()); setActiveProviderId(''); }, 0);
setTimeout(() => setSelectedSeason(season), 0);
```

These exist to avoid "update during render" warnings but mask the real problem: state updates triggered directly inside `useEffect` bodies. The fix is structuring effects correctly, not deferring them.

```ts
// ✅ AFTER — use startTransition for non-urgent updates
import { startTransition } from 'react';

useEffect(() => {
  if (providers.length > 0 && !activeProviderId) {
    startTransition(() => setActiveProviderId(providers[0].id));
  }
}, [providers, activeProviderId]);
```

---

## 🟢 MINOR-2: Episode Quick-Nav Renders Up to 20 Buttons Unconditionally

**File:** `watch/[id]/page.tsx` — lines 434–449

```ts
Array.from({ length: Math.min(20, currentSeasonData?.episode_count || 10) }, ...)
```

For a long season this creates 20 DOM nodes on every render cycle. Wrap in `useMemo`.

```ts
const episodeButtons = useMemo(() =>
  Array.from({ length: Math.min(20, currentSeasonData?.episode_count || 0) }, (_, i) => i + 1),
  [currentSeasonData?.episode_count]
);
```

---

## Checklist
- [ ] Remove module-level Map cache from edge runtime in `title/route.ts`
- [ ] Add `next: { revalidate }` per-fetch in TMDB calls
- [ ] Add AbortController + 15s timeout to `extract()` in StreamPlayer
- [ ] Replace sort-based eviction with insertion-order LRU in `resolve/route.ts`
- [ ] Make `fetchWithRetry` accept per-call `revalidate`
- [ ] Replace `setTimeout(fn, 0)` with `startTransition`
- [ ] Memoize episode quick-nav array
