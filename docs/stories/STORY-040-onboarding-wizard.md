# STORY-040 — Onboarding wizard

**Status:** `todo`
**Estimate:** 5
**Dependencies:** STORY-037 (✅ auth + per-user tenant), STORY-038 (✅ RLS + helper).
**Blocks:** STORY-041 (analytics — useful to track funnel steps), STORY-042 (landing — copy will reference the wizard).

## User story

> **As** a new business owner who just signed up to Babun,
> **I want** a brief 4-step wizard that captures the basics about my business,
> **so that** I land on a properly-configured dashboard instead of an empty grey page that doesn't tell me what to do.

## Why now

Production is multi-tenant + RLS-isolated. The next visible bottleneck for new tenants is that they sign up, land on `/dashboard/clients`, see «0 клиентов», and don't know what to do. The wizard is **the very first thing a new user sees** — it has to feel like part of Babun, not a generic SaaS quiz, and finish in under a minute.

## Acceptance criteria

1. `/onboarding` is its own server-gated route — auth required, redirects to `/dashboard/clients` if `tenants.onboarded_at` is already set.
2. Wizard has 4 steps with a top progress bar; can go forward AND back (step 4 commits, no back from there).
3. Step 1 (business name) pre-fills from `tenants.name` unless that value looks like an email; otherwise empty with a Russian placeholder.
4. Step 2 (vertical) shows 5 options as iOS-grouped-list cards: HVAC / beauty / auto / cleaning / other.
5. Step 3 (city) is optional, has a `<datalist>` of major Cyprus cities, accepts free text.
6. Step 4 (done) commits via single PATCH to `tenants` with `name + vertical + city + onboarded_at = now()`; offers two CTAs: «Добавить первого клиента» → `/dashboard/clients/new`, «Перейти к панели» → `/dashboard/clients`.
7. After commit, the dashboard server gate sees `onboarded_at IS NOT NULL` and lets the user in.
8. Existing users who registered before this story DON'T get bounced to onboarding (G6 backfill).
9. Direct GET on `/onboarding` for an already-onboarded user → redirects to `/dashboard/clients` (no infinite loop).
10. `tsc --noEmit` green; smoke 9/9 passes locally + on production after deploy.

## Architectural decisions (locked)

### A1 — Route group `(onboarding)`, NOT under `/dashboard/`

The route lives at `apps/web/src/app/onboarding/page.tsx` (no group needed — it's a single route with its own server gate). It does NOT share the dashboard's heavy 935-line client layout (sidebar, all the contexts, schedule/clients/appointments providers, etc.). The wizard is intentionally minimal — even Sidebar/BottomTabBar are absent so the user can't sidetrack into half-configured screens.

The auth + onboarded-status check lives directly in `app/onboarding/page.tsx` as a server component, mirroring STORY-037's pattern.

### A2 — `/dashboard/layout.tsx` is the source of truth for «is onboarded?»

Two layers, in this order:

1. **Server gate (`/dashboard/layout.tsx`)** — extends the existing tenant lookup to also read `tenants.onboarded_at`. If null → `redirect("/onboarding")`. This is bulletproof: any way the user reaches a dashboard URL goes through this check.

2. **Client-side push after sign-in/sign-up** — for UX (skip a redirect bounce). `LoginForm` and `RegisterForm` can either trust the server (let `/dashboard/clients` redirect them), or push directly to `/onboarding` if they know the tenant isn't onboarded. **Decision: trust the server.** Saves one round-trip but adds two query points to keep in sync; not worth it for ~50ms gain. The tiny flash on first navigation is acceptable.

### A3 — G6 backfill: variant A (timestamp `onboarded_at = created_at` for everything pre-migration)

```sql
update public.tenants
   set onboarded_at = created_at
 where onboarded_at is null;
```

Run as part of the same migration that adds the column. Catches every existing user (production has me + the dev `00000000-…-babb` orphan). New tenants — those created AFTER the migration runs — get `onboarded_at = null` from the column default and go through the wizard.

The `created_at` value for backfill is more honest than `now()` — it lets analytics still count «registered_at» without the noise of a fake catch-up timestamp.

### A4 — Wizard state lives in React useState, not URL params

The wizard is a single client component with `step: 1|2|3|4` in local state. Going back is just `setStep(step - 1)`. We don't push to history because:

- Browser back from step 2 should NOT escape onboarding — that's confusing. `useState` keeps the user inside the wizard until they explicitly leave on step 4.
- URL-driven steps make Pre-fill / re-renders messy when the form is incomplete.

Trade-off: refresh in the middle of wizard resets to step 1 (with already-typed name preserved if it was saved to tenants on each step — but **we don't save until step 4 commit**). For onboarding, refresh is a 5-second redo. Acceptable.

### A5 — One PATCH on commit, not per-step writes

Step 4's commit is the ONLY DB write. Steps 1–3 collect into local state. This:

- Keeps the wizard's commit atomic (either onboarding completes or nothing changes).
- Avoids partial states where the user reloaded mid-wizard, leaving `vertical = 'beauty'` but `city = NULL` and `onboarded_at = NULL` (incomplete).
- Simpler error UX — one place to show «Не удалось сохранить, попробуй ещё раз».

If commit fails, stay on step 4 with retry. Step 4 also keeps the entered values visible (read-only summary above CTAs) so the user sees what's about to be saved.

### A6 — Step 1 pre-fill heuristic

The trigger from STORY-037 sets `tenants.name = coalesce(raw_user_meta_data->>'business_name', email)`. For users who didn't provide a `business_name` at signup (the common case — RegisterForm makes that field optional), `tenants.name` is their email like `dima@airfix.cy`.

Step 1 pre-fill logic:
```ts
const initialName = tenant.name && !tenant.name.includes("@") ? tenant.name : "";
```

If empty → input shows placeholder «Например, AirFix или Beauty Studio Анны». If pre-filled (user did type business_name on signup), input is editable; user can keep or replace.

## Technical plan

### G0 — Pre-flight (read-only)

Confirm:
- `tenants` schema currently has `id, name, vertical, owner_user_id, created_at` (will verify via Dashboard before G1).
- `current_tenant_id()` helper from STORY-038 exists and returns user's tenant.
- No existing `app/onboarding` route.

(Skip if all confirmed; fold into G1 commit.)

### G1 — SQL migration (interactive: stop and apply via Dashboard)

**File: `apps/web/supabase/migrations/20260430000001_onboarding.sql`**

```sql
-- ─────────────────────────────────────────────────────────────────────
-- STORY-040 — onboarding columns + backfill.
--
-- After this migration:
--   * tenants.city text — optional, free-form, no constraint.
--   * tenants.onboarded_at timestamptz — NULL for users who haven't
--     completed the wizard yet; set to now() on commit.
--   * Existing tenants (created before this migration) are
--     backfilled with onboarded_at = created_at so they don't get
--     bounced into the wizard on next visit (variant A from A3).
-- ─────────────────────────────────────────────────────────────────────

-- ── 1. Schema ────────────────────────────────────────────────────────
alter table public.tenants
  add column if not exists city text,
  add column if not exists onboarded_at timestamptz;

-- ── 2. Backfill existing users ───────────────────────────────────────
-- Stamps every pre-migration tenant as already-onboarded so they
-- don't get redirected to /onboarding on next visit. Uses
-- created_at so analytics can still tell signup-from-onboarding
-- apart from this catch-up sweep.
update public.tenants
   set onboarded_at = created_at
 where onboarded_at is null;

-- ── 3. RLS unchanged ─────────────────────────────────────────────────
-- The existing tenants_update_own policy from STORY-038 already
-- covers UPDATE on the new columns (it's column-agnostic). The
-- tenants_prevent_owner_change trigger continues to guard
-- owner_user_id as before.
```

**Apply via Dashboard SQL Editor, wait for `applied`.**

### G2 — Server gate at `/onboarding`

`apps/web/src/app/onboarding/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";
import OnboardingWizard from "@/components/onboarding/OnboardingWizard";

export default async function OnboardingPage() {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, name, vertical, city, onboarded_at")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (!tenant) {
    // Same broken-state path as the dashboard — surface via /login.
    redirect("/login?error=tenant_missing");
  }
  if (tenant.onboarded_at) {
    redirect("/dashboard/clients");
  }

  return (
    <OnboardingWizard
      tenantId={tenant.id}
      initialName={tenant.name && !tenant.name.includes("@") ? tenant.name : ""}
      initialVertical={tenant.vertical && tenant.vertical !== "unknown" ? tenant.vertical : null}
      initialCity={tenant.city ?? ""}
    />
  );
}
```

### G3 — `/dashboard/layout.tsx` extends the gate

```tsx
const { data: tenant } = await supabase
  .from("tenants")
  .select("id, onboarded_at")  // add onboarded_at
  .eq("owner_user_id", user.id)
  .maybeSingle();

if (error || !tenant) {
  redirect("/login?error=tenant_missing");
}
if (!tenant.onboarded_at) {
  redirect("/onboarding");
}
```

This is the single source of truth for «can they see the dashboard?».

### G4 — `OnboardingWizard.tsx` (client component)

`apps/web/src/components/onboarding/OnboardingWizard.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import OnboardingShell from "./OnboardingShell";        // logo + progress bar
import StepBusinessName from "./StepBusinessName";
import StepVertical from "./StepVertical";
import StepCity from "./StepCity";
import StepDone from "./StepDone";

type Vertical = "hvac" | "beauty" | "auto" | "cleaning" | "other";

interface Props {
  tenantId: string;
  initialName: string;
  initialVertical: Vertical | null;
  initialCity: string;
}

export default function OnboardingWizard({
  tenantId,
  initialName,
  initialVertical,
  initialCity,
}: Props) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [name, setName] = useState(initialName);
  const [vertical, setVertical] = useState<Vertical | null>(initialVertical);
  const [city, setCity] = useState(initialCity);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const commit = async (next: "new-client" | "dashboard") => {
    if (saving) return;
    if (!name.trim() || !vertical) return; // step 4 reachable only after 1+2
    setSaving(true);
    setError(null);
    const supabase = getSupabaseBrowser();
    const { error: err } = await supabase
      .from("tenants")
      .update({
        name: name.trim(),
        vertical,
        city: city.trim() || null,
        onboarded_at: new Date().toISOString(),
      })
      .eq("id", tenantId);
    if (err) {
      setError(err.message);
      setSaving(false);
      return;
    }
    router.push(next === "new-client" ? "/dashboard/clients/new" : "/dashboard/clients");
    router.refresh(); // re-evaluate dashboard server gate
  };

  return (
    <OnboardingShell step={step} totalSteps={4}>
      {step === 1 && (
        <StepBusinessName
          value={name}
          onChange={setName}
          onNext={() => setStep(2)}
        />
      )}
      {step === 2 && (
        <StepVertical
          value={vertical}
          onChange={setVertical}
          onBack={() => setStep(1)}
          onNext={() => setStep(3)}
        />
      )}
      {step === 3 && (
        <StepCity
          value={city}
          onChange={setCity}
          onBack={() => setStep(2)}
          onNext={() => setStep(4)}
        />
      )}
      {step === 4 && (
        <StepDone
          name={name}
          vertical={vertical}
          city={city}
          onBack={() => setStep(3)}
          onCommit={commit}
          saving={saving}
          error={error}
        />
      )}
    </OnboardingShell>
  );
}
```

Each step component is its own file (~80–120 lines), well under the 400-line limit. Total wizard: ~600 lines split across 6 files.

**`OnboardingShell.tsx`** renders:
- Top: Babun «B» logo (same 80×80 from auth pages)
- Below logo: 4-segment progress bar (filled 1..step, dim 1..4-step)
- Centered card with `bg-[var(--surface-card)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)]` (same as auth)
- `OnboardingShell` accepts `children` for the active step's content

**`StepBusinessName.tsx`**:
- Title «Как называется ваш бизнес?»
- Single input, `placeholder="Например, AirFix или Beauty Studio Анны"`
- Pill button «Далее», disabled if `value.trim().length < 2`

**`StepVertical.tsx`**:
- Title «Чем вы занимаетесь?»
- Sub: «Выберите ближайшее. Это можно поменять позже.»
- 5 list-style cards (`divide-y` like the iOS grouped list in auth):
  - 🌬️ Кондиционеры (HVAC)
  - 💅 Красота и здоровье
  - 🚗 Авто-сервис
  - 🧹 Клининг
  - 🛠️ Другое
- Each card is a `<button>` with check-mark indicator on selected
- Pill «Далее» disabled until selection; ghost link «← Назад» above

**`StepCity.tsx`**:
- Title «В каком городе вы работаете?»
- Sub: «Можно пропустить — это поможет в будущем фильтрах и аналитике.»
- Single input with `<datalist id="cyprus-cities">` — Nicosia, Limassol, Larnaca, Paphos, Famagusta, Ayia Napa, Protaras, Kyrenia. Free text accepted.
- Pill «Далее» (always enabled — city is optional); ghost link «← Назад»

**`StepDone.tsx`**:
- Title «Всё готово!»
- Sub: «Babun настроен. Можно добавить первого клиента — или сразу к панели.»
- Read-only summary card (the values from steps 1–3) so the user sees what's about to be saved.
- Two pill buttons:
  - Primary: «Добавить первого клиента» → `commit('new-client')`
  - Secondary (ghost outlined): «Перейти к панели» → `commit('dashboard')`
- Inline error if commit failed; ghost link «← Назад» to step 3

### G5 — Smooth transitions

Pure CSS — wrap the active step's content with a key-based remount + CSS animation:

```tsx
// in OnboardingShell
<div className="min-h-[280px]" key={step}>
  <div className="onboarding-step-enter">{children}</div>
</div>

// globals.css
.onboarding-step-enter {
  animation: onboarding-slide-in 220ms cubic-bezier(0.2, 0.6, 0.2, 1) both;
}
@keyframes onboarding-slide-in {
  from { opacity: 0; transform: translate3d(8px, 0, 0); }
  to { opacity: 1; transform: translate3d(0, 0, 0); }
}
@media (prefers-reduced-motion: reduce) {
  .onboarding-step-enter { animation: none; }
}
```

Respects reduced-motion. No framer-motion dependency.

### G6 — Backfill (already in G1 SQL)

No separate group. The `update tenants set onboarded_at = created_at where onboarded_at is null` in the same migration handles it.

**Verification immediately after applying the migration (still in G1 step):**

```sql
-- Should return 0 — every existing tenant must have a non-null
-- onboarded_at after the backfill.
select count(*) from public.tenants where onboarded_at is null;
```

If it returns >0, something went wrong with the UPDATE — investigate before continuing.

### G7 — Smoke test (9 steps, Chrome DevTools + REST verification)

**Mandatory before G8.** If any step fails — don't bump versions, don't push.

| # | Step | Expected | Verify |
|---|---|---|---|
| 1 | Register a fresh user `smoketest-onb-{ts}@babun.test` | redirect to `/onboarding` (not `/dashboard/clients`) | URL after submit |
| 2 | Step 1: type «Test Business» → click «Далее» | step 2 visible, progress bar 2/4 | snapshot |
| 3 | Step 2: click «Кондиционеры (HVAC)» card → click «Далее» | step 3 visible, progress bar 3/4 | snapshot |
| 4 | Step 3: type «Paphos» → click «Далее» | step 4 visible, progress bar 4/4, summary shows all 3 values | snapshot |
| 5 | Step 4: click «Перейти к панели» | redirect to `/dashboard/clients` | URL |
| 6 | DB check: `select name, vertical, city, onboarded_at from tenants where owner_user_id = '<userId>'` | name=«Test Business», vertical=«hvac», city=«Paphos», onboarded_at non-null | REST + publishable key (RLS allows own tenant) |
| 7 | Logout, login again with same credentials | direct redirect to `/dashboard/clients` (NOT `/onboarding`) | URL |
| 8 | While signed in, manually navigate to `/onboarding` | redirect to `/dashboard/clients` | URL |
| 9 | Cleanup: delete test user via Dashboard SQL Editor | `select count from auth.users where email like 'smoketest-onb-%'` returns 0 | SQL |

If 9/9 pass → G8.

### G8 — Bump + push

- `packages/shared/src/common/utils/version.ts` → `BUILD_VERSION = "v347-onboarding"`
- `apps/web/public/sw.js` → `CACHE_VERSION = "babun-v347"`
- Commit, push to master, wait for Vercel deploy.
- Re-run the same 9-step smoke against `babun2.vercel.app` (production verification, same gate as STORY-038 G6.5). If 9/9 → declare closed; if anything fails → revert v347 release commit, keep migration applied.

## Files touched

### Create

| Path | Purpose |
|---|---|
| `apps/web/supabase/migrations/20260430000001_onboarding.sql` | city + onboarded_at columns + backfill |
| `apps/web/src/app/onboarding/page.tsx` | server gate |
| `apps/web/src/components/onboarding/OnboardingWizard.tsx` | client wizard root |
| `apps/web/src/components/onboarding/OnboardingShell.tsx` | logo + progress bar + step container |
| `apps/web/src/components/onboarding/StepBusinessName.tsx` | step 1 |
| `apps/web/src/components/onboarding/StepVertical.tsx` | step 2 |
| `apps/web/src/components/onboarding/StepCity.tsx` | step 3 |
| `apps/web/src/components/onboarding/StepDone.tsx` | step 4 + commit |

### Modify

| Path | Change |
|---|---|
| `apps/web/src/app/dashboard/layout.tsx` | select also `onboarded_at`; redirect to `/onboarding` if null |
| `apps/web/src/app/globals.css` | `.onboarding-step-enter` animation + reduced-motion guard |
| `packages/shared/src/db/database.types.ts` | tenants Row + Insert + Update gain `city: string \| null` and `onboarded_at: string \| null` |
| `packages/shared/src/common/utils/version.ts` | `BUILD_VERSION = "v347-onboarding"` |
| `apps/web/public/sw.js` | `CACHE_VERSION = "babun-v347"` |

### Delete

None.

## Out of scope (next stories)

- **STORY-039** — teams/roles inside a tenant (will reuse onboarding for "create team" later).
- **STORY-041** — analytics + funnel tracking on the wizard steps.
- **STORY-042** — landing page (will link to `/register` which feeds the wizard).
- CSV import of existing clients during onboarding (separate story).
- Per-vertical UI in client cards (when we have data showing different verticals need different blocks).
- Edit-after-onboarding screen (settings → business info — nice to have, not blocking).

## Risks

**R1 — Race between signup → trigger → first dashboard render.** STORY-037 G2 fixed the JWT-stamp race with `refreshSession()`. The same protection applies here: by the time `/dashboard/layout.tsx` runs, the trigger has inserted the tenants row (with `onboarded_at = null`), so the `redirect("/onboarding")` fires deterministically. **Mitigation:** the helper from STORY-038 G1 has a DB fallback path; even if the JWT lacks tenant_id, the tenants lookup by `auth.uid()` works. The same is true for the `onboarded_at` check — it's a direct query on tenants, not on JWT claims.

**R2 — Existing prod users skip onboarding.** Variant A backfill in G1 stamps every pre-migration tenant as already-onboarded. **Verification:** the post-migration count query (G6 verification block). If the SQL UPDATE didn't run for some reason, existing users would land in onboarding on next visit — annoying but not destructive (they finish in 30 seconds and proceed). Worst case: I add an explicit "skip onboarding" button on step 1 in a quick follow-up.

**R3 — Wizard reload mid-flow loses state.** Refresh on step 2 → user lands back on step 1 with empty fields. Acceptable trade-off for atomicity (A5). If users complain, can add per-step localStorage cache as a follow-up.

**R4 — `tenants.name` ends up containing email if user skipped business_name on signup AND on onboarding step 1.** Step 1 forces 2+ chars, so user MUST type something. But our pre-fill heuristic detects emails (`@`) and clears the field — the user can't accidentally save their email as business name unless they re-type it explicitly.

**R5 — `vertical` enum drift.** STORY-040 picks 5 values; STORY-037's trigger sets default 'unknown'. New tenant rows have `vertical = 'unknown'` until the wizard commits. The dashboard doesn't currently render anything based on vertical, so this is invisible. If we later add a check constraint on vertical, the wizard MUST be the only writer (which it is). **Mitigation:** TypeScript `Vertical` union type; no DB-level constraint for now (gives us flexibility to add new verticals without migrations).

**R6 — Server-gate change in `/dashboard/layout.tsx` could regress STORY-037/038 flows.** Adding the `onboarded_at` check is a single new redirect branch. **Mitigation:** smoke step 7 explicitly verifies that an already-onboarded user goes straight to `/dashboard/clients` (no /onboarding bounce); step 8 verifies the inverse (manual /onboarding URL while onboarded → bounces back to dashboard).

## Working order

1. **architect** (this file) → user reads, says «ок» / «делай».
2. **developer**:
   - **G0** — pre-flight read-only verification.
   - **G1** — write migration; print full SQL to chat for review; user pastes into Dashboard SQL Editor; verify backfill count = 0; wait for `applied`. Commit.
   - **G2** — `app/onboarding/page.tsx` server gate.
   - **G3** — `/dashboard/layout.tsx` adds onboarded check.
   - **G4** — `OnboardingWizard` + 4 step components + `OnboardingShell`.
   - **G5** — globals.css animation.
   - **G6** — already in G1 SQL; just verify.
   - **G7** — local smoke 9/9. **Gate.**
   - **G8** — bump versions, single commit + push, production smoke 9/9. Cleanup test users.
3. **reviewer** — `git diff master`:
   - server gate handles all four cases (no user, no tenant, not onboarded, onboarded)
   - PATCH commit uses `current_tenant_id()` indirectly via RLS (no direct service-role)
   - email pre-fill heuristic doesn't accidentally leak email into `tenants.name`
   - reduced-motion respected
   - no `any`, no `@ts-ignore`
   - tsc + eslint green

## Constraints (reminders from CLAUDE.md)

- 400 lines per component (Wizard splits into 6 files; each well under).
- TypeScript strict; no `any`.
- Don't touch ServiceWorkerRegister, swipe / pinch / `touch-action`, calendar, appointments / finance / chats data layers.
- One logical commit per group (G1..G8).
- RU in UI strings, EN in code.
- Auth flow stays intact: `/login`, `/register`, `/forgot-password`, `/reset-password`, `/auth/callback` unchanged.
- RLS policies untouched (the wizard's PATCH on `tenants` uses the existing `tenants_update_own` policy).
