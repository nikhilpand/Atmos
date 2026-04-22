# 04 — Architecture & SOLID Refactor

## SOLID Violations

### SRP — Single Responsibility

**`StreamPlayer.tsx`** violates SRP by doing 5 things in one file:
1. GDrive streaming decision
2. HLS stream extraction (async fetch logic)
3. Provider iframe rendering
4. Ad-blocking overlay
5. Health reporting

**`title/route.ts`** violates SRP:
1. TMDB fetching
2. Meta server enrichment
3. Response shape construction (3 different builders)
4. In-memory cache management
5. Episode fetching (mixed into the same GET handler via `seasonNum` branch)

---

### Refactor Plan: StreamPlayer → 3 Files

```
src/components/player/
  StreamPlayer.tsx          ← orchestrator only (decides which mode)
  HlsExtractor.tsx          ← HLS extraction logic + loading UI
  IframePlayer.tsx          ← iframe + ad blocker (already exists, extract it)
  AdBlockerOverlay.tsx      ← single-purpose overlay component
  hooks/
    useStreamExtraction.ts  ← pure extraction hook (testable in isolation)
    useHealthReport.ts      ← health reporting hook
```

**`useStreamExtraction.ts` (extracted hook):**
```ts
export function useStreamExtraction(params: {
  tmdbId?: string;
  mediaType?: 'movie' | 'tv';
  season?: number;
  episode?: number;
  enabled: boolean;
}) {
  const [state, setState] = useState<ExtractionState>({
    status: 'idle', // 'idle' | 'loading' | 'success' | 'failed'
    url: null,
    log: 'Locating Stream...',
  });

  useEffect(() => {
    if (!params.enabled || !params.tmdbId) return;
    let cancelled = false;
    const controller = new AbortController();

    async function run() {
      setState(s => ({ ...s, status: 'loading', log: 'Fetching metadata...' }));
      try {
        // ... extraction logic
        if (!cancelled) setState({ status: 'success', url: streamUrl, log: 'Stream found!' });
      } catch {
        if (!cancelled) setState(s => ({ ...s, status: 'failed' }));
      }
    }

    run();
    return () => { cancelled = true; controller.abort(); };
  }, [params.tmdbId, params.mediaType, params.season, params.episode, params.enabled]);

  return state;
}
```

---

### Refactor Plan: `title/route.ts` → Split Episode Route

```
src/app/api/
  title/route.ts          ← title detail only (no episode logic)
  episodes/route.ts       ← NEW: /api/episodes?id=&season=
```

```ts
// episodes/route.ts (new file)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const season = searchParams.get('season');
  if (!id || !season) return NextResponse.json({ error: 'Missing params' }, { status: 400 });
  // episode fetching logic extracted here
}
```

---

## DRY Violations

### 1. Spinning Loader Duplicated 3×

Identical animated spinner appears in:
- `StreamPlayer.tsx` lines 331–334 (extraction loading)
- `StreamPlayer.tsx` lines 207–212 (iframe loading)  
- `watch/[id]/page.tsx` lines 473–476 (resolving state)

```ts
// ✅ Extract to src/components/ui/Spinner.tsx
export function Spinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const dim = { sm: 'w-10 h-10', md: 'w-16 h-16', lg: 'w-20 h-20' }[size];
  return (
    <div className={`relative ${dim}`}>
      <div className="absolute inset-0 rounded-full border-2 border-white/5" />
      <div className="absolute inset-0 rounded-full border-2 border-t-violet-500 animate-spin" />
      <div className="absolute inset-2 rounded-full border-2 border-t-cyan-400/60 animate-spin"
        style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
    </div>
  );
}
```

### 2. `SUBS_URL` Defined Twice

- `constants.ts` line 8: `export const SUBS_URL = process.env.NEXT_PUBLIC_SUBS_URL || '...'`
- `resolve/route.ts` line 17: `const SUBS_URL = process.env.NEXT_PUBLIC_SUBS_URL || '...'`

**Fix:** Import from `constants.ts` in `resolve/route.ts`.

### 3. Health Cache Pattern Duplicated

`resolve/route.ts` has two identical TTL-cache patterns (healthCache, providerCache). Extract to a generic helper:

```ts
function makeTTLCache<T>(ttlMs: number) {
  let data: T | null = null;
  let timestamp = 0;
  return {
    get(): T | null { return Date.now() - timestamp < ttlMs ? data : null; },
    set(value: T) { data = value; timestamp = Date.now(); },
    clear() { data = null; },
  };
}

const healthCache = makeTTLCache<HealthData>(90_000);
const providerCache = makeTTLCache<Provider[]>(5 * 60_000);
```

---

## Anti-Patterns

### God Component: `WatchPageInner`

`watch/[id]/page.tsx` is 513 lines managing:
- URL parameter parsing
- 3 separate React Query calls
- Episode navigation state
- Provider failover state
- Controls auto-hide timer
- Season/episode drawer UI
- Player mounting decision

**Split into:**
```
watch/[id]/
  page.tsx                  ← Suspense shell only
  WatchPageInner.tsx        ← top-level orchestrator
  components/
    EpisodeDrawer.tsx
    EpisodeNavBar.tsx
    PlayerArea.tsx
    TopControls.tsx
  hooks/
    useWatchState.ts        ← all state + derived values
    useProviderFallback.ts  ← provider error handling
```

---

## Checklist
- [ ] Extract `Spinner` to `src/components/ui/Spinner.tsx`
- [ ] Extract `AdBlockerOverlay` to its own file
- [ ] Create `useStreamExtraction.ts` hook
- [ ] Create `useHealthReport.ts` hook
- [ ] Split episode fetch into `/api/episodes/route.ts`
- [ ] Remove duplicate `SUBS_URL` from `resolve/route.ts`
- [ ] Create `makeTTLCache` utility in `src/lib/cache.ts`
- [ ] Split `WatchPageInner` into sub-components
- [ ] Create `useWatchState` hook
