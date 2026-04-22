# 08 — Execution Checklist (Ordered)

Execute in this sequence. Each item is atomic and independently verifiable.

---

## Phase 1 — Security (Do First, No Exceptions)

- [ ] **S1.** Create `src/lib/constants.server.ts` with `import 'server-only'`
- [ ] **S2.** Move `ADMIN_PASSWORD` to `constants.server.ts`, remove from `constants.ts`
- [ ] **S3.** Remove `NEXT_PUBLIC_TMDB_API_KEY` fallback — use `TMDB_API_KEY` server-only
- [ ] **S4.** Add SSRF allowlist to `proxy/route.ts` (block private IPs + enforce origin list)
- [ ] **S5.** Replace `sandbox=""` with `sandbox="allow-scripts allow-same-origin allow-forms"` on iframe — drops `allow-popups`
- [ ] **S6.** Remove `window.open` override (now handled by sandbox)
- [ ] **S7.** Add `middleware.ts` with IP-based rate limiting (60 req/min)
- [ ] **S8.** Restrict CORS on proxy to known origins (not `*`)
- [ ] **Verify:** Run `grep -r "NEXT_PUBLIC_TMDB" src/` — should return 0 results

---

## Phase 2 — Error Handling

- [ ] **E1.** Create `src/lib/logger.ts` with structured JSON logging
- [ ] **E2.** Replace all empty `catch {}` with `logger.error()` calls
- [ ] **E3.** Fix HTTP status in `title/route.ts:344` — return 502 not 200 on failure
- [ ] **E4.** Add `AbortController` + 15s timeout to `StreamPlayer` `extract()` function
- [ ] **E5.** Add radix `10` to all `parseInt()` calls
- [ ] **E6.** Fix stale closure in `handleIframeLoad` using `useRef`
- [ ] **E7.** Define `ProviderMedia` type union in `movieWebClient.ts` — remove `any`
- [ ] **E8.** Add `extractStreamUrl()` type-safe helper function
- [ ] **Verify:** Run `npx tsc --noEmit` — zero type errors

---

## Phase 3 — Architecture Refactoring

- [ ] **A1.** Extract `Spinner` component to `src/components/ui/Spinner.tsx`
- [ ] **A2.** Extract `AdBlockerOverlay` to `src/components/player/AdBlockerOverlay.tsx`
- [ ] **A3.** Extract `IframePlayer` to `src/components/player/IframePlayer.tsx`
- [ ] **A4.** Create `src/lib/cache.ts` with `makeTTLCache<T>()` utility
- [ ] **A5.** Refactor `resolve/route.ts` to use `makeTTLCache` for both caches
- [ ] **A6.** Remove duplicate `SUBS_URL` from `resolve/route.ts` — import from `constants.ts`
- [ ] **A7.** Create `useStreamExtraction.ts` hook — extract logic from `StreamPlayer`
- [ ] **A8.** Create `useHealthReport.ts` hook — extract `reportHealth` from `IframePlayer`
- [ ] **A9.** Create `src/app/api/episodes/route.ts` — move episode fetching from `title/route.ts`
- [ ] **A10.** Split `WatchPageInner` into `TopControls`, `EpisodeDrawer`, `EpisodeNavBar`, `PlayerArea`
- [ ] **Verify:** `npm run build` succeeds with no warnings

---

## Phase 4 — Performance

- [ ] **P1.** Change `title/route.ts` from `edge` to `nodejs` runtime (or use `next: { revalidate }`)
- [ ] **P2.** Add `next: { revalidate: 86400 }` to TMDB fetches in `tmdbFetch()`
- [ ] **P3.** Refactor `fetchWithRetry` in `api.ts` to accept per-call `revalidate` option
- [ ] **P4.** Replace sort-based cache eviction in `resolve/route.ts:244` with insertion-order LRU
- [ ] **P5.** Replace `setTimeout(fn, 0)` with `startTransition` in `watch/[id]/page.tsx`
- [ ] **P6.** Wrap episode quick-nav array in `useMemo`
- [ ] **Verify:** Lighthouse score on `/watch/[id]` — target Performance > 80

---

## Phase 5 — Dead Code Cleanup

- [ ] **D1.** Implement `src/app/api/extract/route.ts` with server-side extraction
- [ ] **D2.** Delete unused `variant` variable in `api.ts:188`
- [ ] **D3.** Audit and confirm `MEDIA_URL` usage — remove if unused
- [ ] **D4.** Populate `similar` array in `buildFromEnrich` or add JSDoc explaining why empty
- [ ] **D5.** Fix aspirational comment in `resolve/route.ts:7` — update to reflect actual behavior
- [ ] **D6.** Episode fallback: return generated stubs not empty array

---

## Phase 6 — Accessibility

- [ ] **AC1.** Add `aria-label` to all icon-only buttons in watch page
- [ ] **AC2.** Add `aria-hidden="true"` to all decorative `<Icon>` components
- [ ] **AC3.** Add `role="dialog"` + `aria-modal="true"` + `aria-labelledby` to episode drawer
- [ ] **AC4.** Install `focus-trap-react` and add focus trap to episode drawer
- [ ] **AC5.** Add `role="status"` + `aria-live="polite"` to all loading spinners
- [ ] **AC6.** Add `aria-current` to active episode buttons
- [ ] **AC7.** Raise all `text-white/30` to `text-white/50` for contrast ratio compliance
- [ ] **Verify:** Run `npx axe-core` or `npx pa11y` on the watch page

---

## Phase 7 — CI/CD Setup

- [ ] **CI1.** Create `.github/workflows/ci.yml` with type-check, lint, test, build steps
- [ ] **CI2.** Add `vitest` + `@testing-library/react` to devDependencies
- [ ] **CI3.** Write unit tests: `computeSmartScore`, `extractStreamUrl`, `makeTTLCache`
- [ ] **CI4.** Write integration test for `/api/resolve` (mock health server)
- [ ] **CI5.** Write Playwright smoke test: load watch page → player appears
- [ ] **CI6.** Add `@sentry/nextjs` for error tracking
- [ ] **CI7.** Configure Axiom or Logtail for structured log ingestion

---

## What's Well-Implemented (Keep As-Is)

✅ **Smart Score algorithm** — the weighted 4-signal scoring in `resolve/route.ts:54-87` is clean and well-commented. Keep it.

✅ **`Promise.allSettled`** in `buildFromTMDB` — correct pattern for concurrent fetches where partial failure is acceptable.

✅ **Season 0 filtering** in `watch/page.tsx:72-75` — handles edge cases (specials-only seasons) correctly.

✅ **React Query config** — `staleTime` values (60m for streams, 24h for titles) are well-chosen and match the TTL strategy.

✅ **`isMounted` guard** in stream extraction — correct pattern for preventing state updates on unmounted components.

✅ **Provider fallback chain** — the 3-tier GDrive → HLS → iframe design is architecturally sound.
