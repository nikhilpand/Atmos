# ATMOS V3.0 — Ultimate Streaming Platform Overhaul

> **Goal**: Transform ATMOS from a basic video grid into a Netflix-tier streaming platform with zero-buffering playback, dedicated content pages, and a premium cinematic UI.

## Background & Diagnosis

After deep-diving into the codebase (818 nodes, 1650 edges across 56 files), here are the **critical problems**:

### Streaming Issues
1. **Single-point-of-failure playback**: `resolveStream()` in `watch/[id]/page.tsx` tries Playwright extraction (20s timeout) then Drive catalog. Both frequently fail → iframe fallback with ads
2. **No link pre-caching**: Every visit re-resolves streams from scratch
3. **Only 4 iframe fallback servers**: `vidsrc.me`, `vidsrc.cc`, `multiembed.mov`, `autoembed.co` — several are unreliable/dead
4. **No quality/audio/subtitle controls** on the native player
5. **HLS player has basic config** — no ABR tuning, no buffer optimization

### UI/UX Issues  
1. **No dedicated movie/show pages** — clicking a card goes straight to `watch/[id]` player
2. **No season/episode selector** for TV shows
3. **No genre/category browsing** — only Trending/Movies/TV pills
4. **No "My List" or continue watching**
5. **Cards use `window.location.href`** instead of Next.js `<Link>` — full page reloads, kills SPA experience
6. **Admin panel is a raw HTML file** at `/public/admin.html` — not integrated

### Architecture Issues
1. **Frontend has only 6 components** total — everything crammed into page files
2. **No API route layer** — all fetches go directly to external HF spaces from client
3. **No streaming link resolver service** — should be a Next.js API route that races providers server-side
4. **Zustand store is skeletal** — only 3 fields

---

## User Review Required

> [!IMPORTANT]
> **Embed Provider Strategy**: The plan uses 8+ embed providers (vidsrc.xyz, vidsrc.cc, vidsrc.in, embed.su, multiembed.mov, autoembed.co, moviesapi.club, smashystream.com, 2embed.cc) raced in parallel. These are community-maintained services that may go up/down. The architecture is designed so adding/removing providers is a one-line change.

> [!WARNING]
> **File Structure Overhaul**: This plan restructures the frontend from 6 files to ~40+ files in a proper Next.js App Router layout. The current `watch/[id]/page.tsx` monolith gets split into dedicated components. **The existing admin.html will be replaced with React pages.**

> [!CAUTION]
> **API Routes on Vercel**: Next.js API routes on Vercel have a 10s timeout (hobby) or 60s (pro). The parallel provider racing needs to complete within this window. We use `Promise.race` with aggressive timeouts to guarantee sub-5s resolution.

---

## Open Questions

1. **Vercel Plan**: Are you on Hobby (10s serverless timeout) or Pro (60s)? This affects how many providers we can race server-side vs. client-side.
2. **Custom Domain**: Do you want to keep `frontend-one-teal-19.vercel.app` or set up a custom domain?
3. **Authentication**: Should there be user accounts (watchlists, continue watching) or keep it admin-only auth?
4. **Legal Awareness**: The embed provider strategy aggregates third-party streaming sources. Are you comfortable with this for your portfolio/career project?

---

## Proposed Changes

### Phase 1 — Streaming Engine (ZERO BUFFERING)

> **Priority: HIGHEST** — This is the core of the platform. Every content request must resolve to a working stream.

---

#### [NEW] `frontend/src/lib/providers.ts` — Provider Registry

Central registry of all embed/streaming providers with health scoring:

```typescript
// 8+ providers, each with embed URL builder, health score, and ad level
// Providers are sorted by reliability score and raced in parallel
// Dead providers auto-disable after 3 consecutive failures
```

**Providers to integrate**:
| Provider | Type | Movies | TV | Anime | Reliability |
|----------|------|--------|-----|-------|-------------|
| vidsrc.xyz | iframe | ✅ | ✅ | ✅ | High |
| vidsrc.in | iframe | ✅ | ✅ | ❌ | High |
| embed.su | iframe | ✅ | ✅ | ❌ | Medium |
| multiembed.mov | iframe | ✅ | ✅ | ❌ | Medium |
| autoembed.co | iframe | ✅ | ✅ | ❌ | Medium |
| 2embed.cc | iframe | ✅ | ✅ | ❌ | Medium |
| moviesapi.club | iframe | ✅ | ✅ | ❌ | Medium |
| smashystream.com | iframe | ✅ | ✅ | ❌ | Low |
| vidsrc.cc | iframe | ✅ | ✅ | ❌ | Low |

---

#### [NEW] `frontend/src/app/api/resolve/route.ts` — Server-Side Stream Resolver

Next.js API route that:
1. Receives TMDB ID + media type + season/episode
2. Races ALL providers in parallel with `Promise.allSettled()` + 5s timeout
3. Returns **ordered list** of working provider URLs
4. Caches results in memory (Map with TTL) for instant re-access
5. Falls back to Drive catalog search if all providers fail

```
GET /api/resolve?id=550&type=movie
→ { providers: [{id: "vidsrc_xyz", url: "...", quality: "auto"}, ...], cached: false }
```

---

#### [NEW] `frontend/src/app/api/providers/route.ts` — Provider Health Endpoint

Returns current provider health status for the admin panel.

---

#### [MODIFY] `frontend/src/app/watch/[id]/page.tsx`

Complete rewrite of the player page:
- Use the new `/api/resolve` route instead of client-side `resolveStream()`
- **Instant Provider Switching**: All provider URLs pre-loaded, user clicks "Server 1/2/3" → instant iframe swap (no re-fetching)
- **Auto-advance**: If current provider fails (iframe error/timeout), automatically try next
- Season/Episode selector for TV content
- Proper metadata display

---

#### [NEW] `frontend/src/components/player/StreamPlayer.tsx`

Unified player component:
- Detects stream type (iframe embed vs. direct HLS vs. Drive proxy)
- For iframes: sandboxed `<iframe>` with ad-blocking CSP headers
- For HLS: Enhanced hls.js config with aggressive buffering
- Auto-advancement between provider fallbacks
- Fullscreen-aware controls

---

#### [NEW] `frontend/src/components/player/ProviderSelector.tsx`

Server selector UI (like Netflix's "Source" button):
- Shows all resolved providers as chips
- Active provider highlighted
- Click to switch instantly (URLs already resolved)
- Health indicators per provider

---

### Phase 2 — Netflix-Grade UI/UX

---

#### [NEW] `frontend/src/app/title/[id]/page.tsx` — Dedicated Title Page

Full dedicated page for each movie/show (like Netflix title detail):
- Hero backdrop with gradient overlay
- Title, year, rating, runtime, genres, overview
- Cast carousel
- Season/Episode selector (for TV)
- "Play" and "Add to List" CTAs
- "More Like This" recommendations
- Trailer embed (YouTube)
- Links directly to `/watch/[id]` player

**Data source**: `/api/title?id=X&type=movie` → hits TMDB detail + credits + similar

---

#### [NEW] `frontend/src/app/api/title/route.ts` — Title Detail API

Server-side TMDB fetch:
- Full detail with credits, similar titles, videos (trailers)
- Caches responses (7-day TTL in memory Map)
- For TV: includes season list with episode details

---

#### [NEW] `frontend/src/app/genre/[id]/page.tsx` — Genre Browsing

Genre-specific content pages:
- Action, Comedy, Drama, Thriller, Horror, Sci-Fi, Animation, Anime, etc.
- Grid layout with infinite scroll
- Data from TMDB discover API

---

#### [NEW] `frontend/src/app/api/genre/route.ts` — Genre Discovery API

Server-side TMDB discover endpoint with genre filtering.

---

#### [MODIFY] `frontend/src/app/page.tsx` — Home Page Redesign

Transform into Netflix-style rows:
- Hero section (keep, polish)
- **Multiple horizontal scroll rows**: "Trending Now", "Popular Movies", "Top Rated TV", "New Releases", "Anime", etc.
- Each row is a reusable `ContentRow` component
- Cards link to `/title/[id]` (NOT directly to player)

---

#### [NEW] `frontend/src/components/media/ContentRow.tsx`

Horizontal scrollable row of cards (Netflix-style):
- Smooth horizontal scroll with arrow buttons
- Shows 6 cards at a time (desktop), 2-3 (mobile)
- Lazy-loaded images
- Hover: card expands slightly with quick info overlay

---

#### [NEW] `frontend/src/components/media/TitleCard.tsx`

Enhanced card replacing `GlassCard.tsx`:
- Poster image with lazy loading + blur placeholder
- On hover: expands with mini-info (rating, year, genres)
- Links to `/title/[id]` via Next.js `<Link>` (SPA navigation)
- Rating badge, TV badge, quality badge

---

#### [NEW] `frontend/src/components/title/TitleHero.tsx`

Full-width hero component for title detail page:
- Backdrop image with parallax effect
- Gradient overlays
- Title, metadata, CTAs

---

#### [NEW] `frontend/src/components/title/SeasonSelector.tsx`

TV show season/episode browser:
- Dropdown for season selection
- Episode list with thumbnails, titles, runtimes
- Click episode → navigates to `/watch/[id]?type=tv&season=X&episode=Y`

---

#### [NEW] `frontend/src/components/title/CastCarousel.tsx`

Horizontal scroll of cast members with profile photos.

---

#### [MODIFY] `frontend/src/components/ui/FrostedNavbar.tsx`

Enhanced navigation:
- Add nav links: Home, Movies, TV Shows, Anime, My List
- Scroll-reactive transparency (transparent at top, frosted on scroll)
- Mobile hamburger menu
- Remove settings gear → move admin to `/admin` route

---

#### [MODIFY] `frontend/src/components/ui/SearchBar.tsx`

Polish:
- Show poster thumbnails in results
- Show media type badge (Movie/TV/Anime)
- Click result → navigate to `/title/[id]` (not watch)
- Keyboard navigation (↑↓ to select, Enter to navigate)

---

#### [MODIFY] `frontend/src/app/globals.css`

Design system expansion:
- Netflix-inspired color palette (dark with red accent)
- Glass morphism tokens
- Row scroll utilities
- Card hover animations
- Responsive breakpoints

---

### Phase 3 — React Admin Dashboard

> Replace the raw `admin.html` with proper Next.js pages

---

#### [NEW] `frontend/src/app/admin/page.tsx` — Admin Dashboard

React-based admin panel:
- Login gate (reuses existing auth system)
- Overview cards (total files, streams today, storage)
- Quick actions

---

#### [NEW] `frontend/src/app/admin/library/page.tsx` — Library Management

- Browse Drive files in a table
- Rename, delete, auto-rename actions
- Filter by type (movie/tv/anime)

---

#### [NEW] `frontend/src/app/admin/providers/page.tsx` — Provider Health

- Real-time provider health status
- Enable/disable providers
- Test stream resolution

---

#### [NEW] `frontend/src/app/admin/layout.tsx` — Admin Layout

Sidebar navigation for admin section.

---

### Phase 4 — State Management & Data Layer

---

#### [MODIFY] `frontend/src/store/useMediaStore.ts`

Expand to full application state:
```typescript
interface MediaState {
  // Watchlist
  myList: number[];
  addToList: (id: number) => void;
  removeFromList: (id: number) => void;
  
  // Continue Watching
  watchHistory: WatchProgress[];
  updateProgress: (id: number, time: number, duration: number) => void;
  
  // Provider state
  resolvedProviders: Map<string, ProviderResult[]>;
  
  // UI state
  searchOpen: boolean;
  activeCategory: string;
}
```
With localStorage persistence via zustand `persist` middleware.

---

#### [NEW] `frontend/src/lib/api.ts` — Centralized API Client

Single API layer for all backend calls:
- `fetchTrending(page, type)`
- `fetchTitle(id, type)`
- `fetchGenre(genreId, page)`
- `resolveStream(id, type, season?, episode?)`
- All with error handling, retry, and caching

---

#### [NEW] `frontend/src/lib/constants.ts`

All URL constants, provider configs, and feature flags.

---

### Phase 5 — Performance & Polish

---

#### Image Optimization
- Replace all `<img>` with Next.js `<Image>` for automatic optimization
- TMDB image proxy through our meta server for CDN caching

#### Navigation
- Replace ALL `window.location.href` with Next.js `<Link>` and `router.push`
- Prefetch title pages on hover

#### Loading States
- Skeleton screens for every page
- Shimmer animations matching content layout
- Progressive image loading with blur-up

#### SEO
- Dynamic `<title>` and meta tags per page
- Open Graph tags for social sharing
- Structured data (JSON-LD) for movies/shows

---

### Phase 6 — File Structure

Current → New structure:

```
frontend/src/
├── app/
│   ├── page.tsx                    # Home (Netflix rows)
│   ├── layout.tsx                  # Root layout
│   ├── globals.css                 # Design system
│   ├── title/
│   │   └── [id]/
│   │       └── page.tsx            # [NEW] Title detail page
│   ├── watch/
│   │   └── [id]/
│   │       └── page.tsx            # [REWRITE] Player page
│   ├── genre/
│   │   └── [id]/
│   │       └── page.tsx            # [NEW] Genre browse
│   ├── browse/
│   │   └── page.tsx                # [NEW] Full catalog
│   ├── admin/
│   │   ├── page.tsx                # [NEW] Admin dashboard
│   │   ├── layout.tsx              # [NEW] Admin sidebar
│   │   ├── library/page.tsx        # [NEW] Library mgmt
│   │   └── providers/page.tsx      # [NEW] Provider health
│   └── api/
│       ├── resolve/route.ts        # [NEW] Stream resolver
│       ├── title/route.ts          # [NEW] Title detail
│       ├── genre/route.ts          # [NEW] Genre discover
│       └── providers/route.ts      # [NEW] Provider health
├── components/
│   ├── ui/
│   │   ├── FrostedNavbar.tsx       # [MODIFY] Enhanced nav
│   │   ├── SearchBar.tsx           # [MODIFY] Enhanced search
│   │   ├── Providers.tsx           # React Query provider
│   │   ├── Skeleton.tsx            # [NEW] Skeleton loaders
│   │   └── Badge.tsx               # [NEW] Rating/type badges
│   ├── media/
│   │   ├── ContentRow.tsx          # [NEW] Netflix-style row
│   │   ├── TitleCard.tsx           # [NEW] Enhanced card
│   │   ├── MediaGrid.tsx           # [MODIFY] Grid layout
│   │   └── GlassCard.tsx           # [DEPRECATE → TitleCard]
│   ├── title/
│   │   ├── TitleHero.tsx           # [NEW] Title hero section
│   │   ├── SeasonSelector.tsx      # [NEW] Season/episode picker
│   │   ├── CastCarousel.tsx        # [NEW] Cast display
│   │   └── SimilarTitles.tsx       # [NEW] Recommendations
│   ├── player/
│   │   ├── StreamPlayer.tsx        # [NEW] Unified player
│   │   ├── ProviderSelector.tsx    # [NEW] Server switcher
│   │   └── PlayerControls.tsx      # [NEW] Custom controls
│   ├── admin/
│   │   ├── AdminSidebar.tsx        # [NEW] Admin nav
│   │   ├── LibraryTable.tsx        # [NEW] File browser
│   │   └── ProviderHealth.tsx      # [NEW] Health cards
│   └── generative/
│       └── ParticleCanvas.tsx      # Keep
├── store/
│   └── useMediaStore.ts            # [MODIFY] Full state
└── lib/
    ├── providers.ts                # [NEW] Provider registry
    ├── api.ts                      # [NEW] API client
    └── constants.ts                # [NEW] Config
```

---

## Verification Plan

### Automated Tests
1. `npm run build` — Verify zero TypeScript/build errors
2. `npm run lint` — Verify ESLint passes
3. Browser test: Navigate home → title page → play → switch providers
4. Browser test: Search → click result → title page loads
5. Browser test: TV show → season selector → episode play
6. Browser test: Admin login → library view → provider health

### Manual Verification
1. Deploy to Vercel → test all routes work
2. Test 10+ movies and 5+ TV shows for stream resolution
3. Test provider switching (all 8+ servers)
4. Test on mobile (responsive design)
5. Verify no full-page reloads (SPA navigation)
6. Verify admin panel authentication

### Performance Benchmarks
- Home page: < 2s LCP (Largest Contentful Paint)
- Title page: < 3s full load
- Stream resolution: < 5s to first provider
- Provider switch: < 200ms (pre-resolved)

---

## Structural Recommendations

> [!TIP]
> 1. **Move admin.html/js/css out of `public/`** — Replace with React pages at `/admin/*`
> 2. **Add `next.config.ts` image domains** — Allow `image.tmdb.org` for Next.js Image optimization
> 3. **Consider Edge Runtime** for API routes — Faster cold starts on Vercel
> 4. **Add `.env.local` variables** for TMDB key and backend URLs — Currently hardcoded in components

## Execution Order

| Phase | Priority | Est. Files | Depends On |
|-------|----------|-----------|------------|
| 1: Streaming Engine | 🔴 Critical | 8 | None |
| 2: Netflix UI/UX | 🔴 Critical | 15 | Phase 1 |
| 3: Admin Dashboard | 🟡 High | 6 | Phase 1 |
| 4: State & Data | 🟢 Medium | 4 | Phase 2 |
| 5: Performance | 🟢 Medium | 3 | Phase 2 |
| 6: File Structure | ⚪ Ongoing | — | All phases |
