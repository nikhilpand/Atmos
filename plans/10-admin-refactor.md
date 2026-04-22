# 10 — Admin Frontend Refactor: Actual State

## Corrected Reality (After File Investigation)

The graph report said `admin.js` vs modular files in `frontend_legacy/` — but **`frontend_legacy/` does not exist** in the current workspace.

The admin UI has **already been fully migrated** to the Next.js app:

| File | Status |
|------|--------|
| `frontend/src/app/admin/page.tsx` | ✅ Admin dashboard (Next.js) |
| `frontend/src/app/admin/layout.tsx` | ✅ Admin layout/auth guard |
| `frontend/src/app/admin/library/page.tsx` | ✅ Drive library |
| `frontend/src/app/admin/providers/page.tsx` | ✅ Provider management |
| `frontend/src/app/admin/discovery/page.tsx` | ✅ Content discovery |

**The old admin.js monolith and frontend_legacy/ are already gone from the workspace.** The graph was analyzing a stale snapshot of the repository that predates the cleanup.

---

## Step 1 — Verify admin.html loads the new files (not admin.js)

```bash
grep -n "admin\.js\|admin-core\|admin-overview\|admin-library" frontend_legacy/admin.html
```

**Expected:** admin.html should reference the modular files, NOT `admin.js`.
**If admin.html still loads admin.js:** That's the blocker — update script tags first.

---

## Step 2 — Function Coverage Audit

Run this to find functions in admin.js that don't exist in the new files:

```bash
grep -o "function [a-zA-Z]*" frontend_legacy/admin.js | sort > /tmp/old_funcs.txt
grep -rho "function [a-zA-Z]*" frontend_legacy/admin-*.js | sed 's/.*function /function /' | sort > /tmp/new_funcs.txt
comm -23 /tmp/old_funcs.txt /tmp/new_funcs.txt
# Output = functions in admin.js not yet in new modules
```

---

## Step 3 — Module Responsibility Map

| New File | Responsibility |
|----------|---------------|
| `admin-core.js` | App bootstrap, auth token management, shared API helpers, global state |
| `admin-overview.js` | Dashboard overview stats panel |
| `admin-library.js` | Drive library browsing, rename, delete |
| `admin-discover.js` | TMDB search, channel search, content discovery |
| `admin-monitoring.js` | System health, logs, bot info |
| `admin-system.js` | Config, schedules, queue management, pull operations |
| `admin-transfers.js` | Transfer queue UI, progress display |

---

## Step 4 — admin.html Script Tag Order (Correct Load Order)

```html
<!-- ❌ REMOVE this if present -->
<script src="admin.js"></script>

<!-- ✅ Correct modular load order -->
<script src="admin-core.js"></script>       <!-- Must be first — defines globals -->
<script src="admin-overview.js"></script>
<script src="admin-library.js"></script>
<script src="admin-discover.js"></script>
<script src="admin-monitoring.js"></script>
<script src="admin-system.js"></script>
<script src="admin-transfers.js"></script>
```

---

## Step 5 — Delete admin.js (After Verification)

Once `admin.html` loads the modular files and everything works:

```bash
# Confirm no HTML file still references admin.js
grep -r "admin\.js" frontend_legacy/*.html
# If empty output → safe to delete
git rm frontend_legacy/admin.js
git rm frontend_legacy/refactor_admin.py  # Script is no longer needed
git commit -m "chore: remove legacy admin.js monolith (replaced by modular admin-*.js)"
```

---

## Step 6 — Migrate to Next.js Admin (Long Term)

The `frontend_legacy/` folder is a static HTML/JS app served separately from the Next.js frontend in `frontend/`. Long-term, the admin UI should be migrated into the Next.js app as protected routes:

```
frontend/src/app/admin/
  page.tsx                ← Admin overview
  library/page.tsx        ← Drive library
  discover/page.tsx       ← TMDB search
  system/page.tsx         ← System monitoring
  layout.tsx              ← Admin auth guard (server component)
```

With a server-side auth guard:
```ts
// app/admin/layout.tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const token = cookies().get('admin_token')?.value;
  if (!token || !verifyAdminToken(token)) redirect('/admin/login');
  return <>{children}</>;
}
```

---

## Checklist
- [ ] Run `grep -n "admin\.js" frontend_legacy/admin.html` — verify it's NOT loaded
- [ ] Run function coverage audit (Step 2) — find any missing functions
- [ ] Verify all 7 new modular JS files are in correct script tag order in admin.html
- [ ] Test all admin panels: overview, library, discover, monitoring, system, transfers
- [ ] Delete `frontend_legacy/admin.js` after verification
- [ ] Delete `frontend_legacy/refactor_admin.py`
- [ ] Git commit the removal
- [ ] (Future) Plan admin migration to Next.js App Router protected routes
