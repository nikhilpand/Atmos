# 06 — Dead Code, TODOs & Stubs

## Dead Code

### 1. Empty `extract` API Directory

**Path:** `src/app/api/extract/` — directory exists but is empty.

This was scaffolded for server-side extraction but never implemented. Currently, extraction runs client-side in `movieWebClient.ts`. Decision needed:

**Option A (recommended):** Move extraction to this route for better reliability:
```ts
// src/app/api/extract/route.ts
export const runtime = 'nodejs'; // @movie-web/providers needs Node
export async function POST(request: NextRequest) {
  const { tmdbId, mediaType, season, episode } = await request.json();
  const url = await extractStreamServer({ tmdbId, mediaType, season, episode });
  return NextResponse.json({ url });
}
```

**Option B:** Delete the empty directory to reduce confusion.

---

### 2. Unused `variant` Variable

**File:** `src/lib/api.ts` — line 188

```ts
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const variant = parts[0] === 'trending' ? 'trending' : parts[1];
```

This variable is computed, marked as unused, and never referenced. It should be deleted.

```ts
// ✅ DELETE this line entirely — variant is never used
```

---

### 3. `MEDIA_URL` Imported but Possibly Unused

**File:** `src/lib/constants.ts` — line 6

`MEDIA_URL` is exported but grep through the codebase to confirm it's actually imported anywhere. If the Playwright media server is not yet integrated, this constant is dead.

```bash
# Check usage
grep -r "MEDIA_URL" src/
```

---

### 4. `similar: []` Always Empty in `buildFromEnrich`

**File:** `title/route.ts` — line 176

```ts
// ❌ BEFORE — hardcoded empty array, never populated
similar: [],
```

The Meta `/enrich` endpoint may return similar titles but the code always discards them. Either populate it or document why it's intentionally empty.

---

### 5. `window.open` Override Never Restored on Re-Mount

**File:** `StreamPlayer.tsx` — lines 122–129

The `useEffect` correctly restores `window.open` on cleanup. However, if the component mounts a second time (e.g., StrictMode double-invoke), the restored `originalOpen` could itself be the patched version from the first mount. This is a subtle idempotency bug in development.

```ts
// ✅ SAFER: patch at module level (once), not in useEffect
// OR: use sandbox attribute on iframe (see security plan)
```

---

## TODO / FIXME / HACK Comments

| Location | Comment | Resolution |
|----------|---------|------------|
| `proxy/route.ts:64` | `// Important to capture redirects` | Not a TODO but the redirect capture logic (lines 78-80) only sets a header but doesn't follow the redirect — document this limitation or implement proper redirect following |
| `title/route.ts:235` | `// Fallback: generate placeholder episodes` | Currently returns `{ episodes: [] }` — should return generated stubs so TV shows don't show empty episode lists |
| `title/route.ts:344` | Comment says "Return 200 with partial data to prevent client crash" | This is wrong — fix the client to handle errors properly and return a real 500/502 |
| `resolve/route.ts:7` | `// Falls back to media_server Playwright extraction if top provider fails.` | This fallback is not implemented — the comment is aspirational, not actual code |

---

## Unused Imports Check

**`watch/[id]/page.tsx` line 4:**
```ts
import React, { useEffect, useState, Suspense, useCallback, useMemo } from 'react';
```
`Suspense` is used only in the wrapper — but with Next.js App Router you can often rely on built-in streaming. Verify `Suspense` is needed.

**`StreamPlayer.tsx` line 4:**
```ts
import { motion, AnimatePresence } from 'framer-motion';
```
`AnimatePresence` is used. `motion` is used. Both valid. ✅

---

## Checklist
- [ ] Implement OR delete `src/app/api/extract/` directory
- [ ] Delete unused `variant` variable in `api.ts` line 188
- [ ] Audit `MEDIA_URL` usage — remove if dead
- [ ] Populate `similar` array in `buildFromEnrich` or add comment
- [ ] Fix the aspirational Playwright fallback comment in `resolve/route.ts:7`
- [ ] Replace `window.open` patch with iframe `sandbox` (ties to security plan)
- [ ] Fix episode fallback to return generated stubs not empty array
