# 05 — Accessibility (WCAG 2.1 AA)

## 🟡 MAJOR-1: Interactive Elements Missing `aria-label`

**File:** `watch/[id]/page.tsx`

Multiple icon-only buttons have no accessible text:

```tsx
// ❌ BEFORE — screen reader says "button" with no context
<button onClick={() => router.push(...)}>
  <ArrowLeft size={14} /> Back
</button>

<button onClick={() => setShowServers(prev => !prev)}>
  <Server size={12} />
  <span className="hidden sm:inline">Servers</span>  {/* hidden on mobile! */}
</button>
```

```tsx
// ✅ AFTER
<button
  aria-label="Go back to title page"
  onClick={() => router.push(...)}
>
  <ArrowLeft size={14} aria-hidden="true" /> Back
</button>

<button
  aria-label={`${showServers ? 'Close' : 'Open'} server selector. ${providers.length} servers available`}
  aria-expanded={showServers}
  aria-controls="server-selector-panel"
  onClick={() => setShowServers(prev => !prev)}
>
  <Server size={12} aria-hidden="true" />
  <span className="hidden sm:inline">Servers</span>
</button>
```

---

## 🟡 MAJOR-2: Episode Buttons Missing Descriptive Labels

**File:** `watch/[id]/page.tsx` — lines 438–449

```tsx
// ❌ BEFORE — announces "button 3" not "Episode 3"
<button key={ep} onClick={() => goToEpisode(season, ep)}>
  {ep}
</button>
```

```tsx
// ✅ AFTER
<button
  key={ep}
  onClick={() => goToEpisode(season, ep)}
  aria-label={`Episode ${ep}${ep === episode ? ', currently playing' : ''}`}
  aria-current={ep === episode ? 'true' : undefined}
>
  {ep}
</button>
```

---

## 🟡 MAJOR-3: Drawer is Not a Dialog — Missing Focus Trap & Role

**File:** `watch/[id]/page.tsx` — lines 281–403 (episode drawer)

The episode drawer slides in from the right but:
- Has no `role="dialog"` or `aria-modal="true"`
- Has no focus trap (keyboard user can tab behind the backdrop)
- No `aria-labelledby` pointing to the h2

```tsx
// ✅ AFTER
<motion.div
  role="dialog"
  aria-modal="true"
  aria-labelledby="episode-drawer-title"
  // focus trap: use `focus-trap-react` or custom hook
>
  <h2 id="episode-drawer-title">{displayTitle}</h2>
  {/* ... */}
</motion.div>
```

**Install:** `npm i focus-trap-react` or use the native `inert` attribute on the background.

---

## 🟢 MINOR-1: Images Missing `alt` Attributes or Using Filename as Alt

**File:** `watch/[id]/page.tsx` — lines 341–346

```tsx
// ❌ BEFORE — alt is episode name which may be empty
<img src={...} alt={ep.name} className="..." loading="lazy" />
```

```tsx
// ✅ AFTER — descriptive alt with fallback
<img
  src={`${TMDB_IMAGE_BASE}/w300${ep.still_path}`}
  alt={ep.name ? `Still from ${ep.name}` : `Episode ${ep.episode_number} thumbnail`}
  loading="lazy"
/>
```

---

## 🟢 MINOR-2: Loading States Have No Live Region Announcement

Screen readers don't announce dynamic spinner content.

```tsx
// ✅ ADD to every loading state:
<div role="status" aria-live="polite" aria-label="Loading stream...">
  <Spinner />
  <p className="sr-only">Loading stream, please wait</p>
</div>
```

---

## 🟢 MINOR-3: AdBlockerOverlay Blocks Keyboard Navigation

**File:** `StreamPlayer.tsx` — lines 56–89

The overlay intercepts clicks but a keyboard user pressing `Enter` or `Space` over the iframe will not trigger it. The overlay also has no `role` or `aria-live` region to announce the ad-blocking state.

```tsx
// ✅ AFTER
<motion.div
  role="status"
  aria-live="assertive"
  aria-label={`Ad shield active. ${MAX_ABSORBED_CLICKS - clicksAbsorbed} clicks remaining to dismiss`}
  tabIndex={0}
  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(e as any); }}
  onClick={handleClick}
>
```

---

## Color Contrast Check (Tailwind Classes)

| Element | Class | Contrast Ratio | WCAG AA (4.5:1) |
|---------|-------|----------------|-----------------|
| Sub-text | `text-white/30` | ~2.3:1 | ❌ Fails |
| Body text | `text-white/60` | ~4.1:1 | ❌ Marginal |
| Primary text | `text-white/70` | ~5.2:1 | ✅ Pass |
| Active state | `text-white` | ~21:1 | ✅ Pass |

**Fix:** Raise `text-white/30` to minimum `text-white/50` across all secondary text.

---

## Checklist
- [ ] Add `aria-label` to all icon-only buttons
- [ ] Add `aria-hidden="true"` to all decorative icons
- [ ] Add `aria-expanded` + `aria-controls` to toggle buttons
- [ ] Add `role="dialog"` + `aria-modal` + focus trap to episode drawer
- [ ] Add `role="status"` + `aria-live` to all loading spinners
- [ ] Fix episode button `aria-current` + descriptive labels
- [ ] Raise `text-white/30` to `text-white/50` for contrast
- [ ] Fix image `alt` text in episode list
