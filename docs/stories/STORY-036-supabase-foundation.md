# STORY-036 — Supabase Foundation (clients vertical PoC)

**Status:** `todo`
**Estimate:** 8 (heavy — split if it overflows)
**Dependencies:** STORY-035 (✅ done — `packages/shared/src/db/types/`, `packages/shared/src/local/`)
**Supersedes (partial):** STORY-001 sub-story 001a/001d for the **clients** resource only
**Blocks:** STORY-037 (auth), STORY-038 (RLS + multi-tenancy), STORY-036b/c/d (other verticals)

## User story

> **As** the Babun owner,
> **I want** my clients to live in a real Postgres database (Supabase),
> **so that** clearing the browser cache does not wipe my data, multiple devices see the same list, and we have a working pattern to migrate the rest of the verticals.

## Why now

LocalStorage was always a stopgap. STORY-035 landed the package boundary (`@babun/shared/db/*` vs `@babun/shared/local/*`) — the migration corridor is finally open. We do **clients only** as the proof-of-concept: one vertical end-to-end (schema → repo → UI) so we can copy the recipe for appointments / finance / chats next. Auth and RLS are intentionally **out of scope** here so the migration risk is contained — every table gets a `tenant_id` column from day one but it stays nullable and unenforced until STORY-038.

## Acceptance criteria

1. `.env.local` exists locally, **never** committed (already covered by `.env*` rule in `babun-crm/apps/web/.gitignore`).
2. `.env.local.example` lists all three vars with placeholder values.
3. Browser Supabase client works in `apps/web/src/lib/supabase/client.ts`.
4. Server Supabase client (with Next 16 async cookies) works in `apps/web/src/lib/supabase/server.ts`.
5. Migration `20260427000001_init_clients.sql` applied to project `qvgemicqeqwz` and visible in Supabase Dashboard.
6. One `tenants` row exists with the agreed `DEV_TENANT_ID` UUID.
7. Generated types file `packages/shared/src/db/database.types.ts` exists and `tsc --noEmit` is green when imported.
8. Repository functions in `packages/shared/src/db/repositories/clients.ts` cover CRUD: `listClients / getClient / createClient / updateClient / deleteClient`.
9. `/dashboard/clients` lists clients fetched from Supabase (skeleton during fetch, error message on failure).
10. `/dashboard/clients/new` writes to Supabase; the new row appears on the list page after save.
11. `/dashboard/clients/[id]` updates and deletes work against Supabase.
12. **Other verticals (appointments, finance, schedule, services, masters, chats) remain on localStorage and do not regress.** Calendar, swipe, pinch-zoom, ServiceWorkerRegister are all untouched.
13. `BUILD_VERSION = "v344-supabase-clients"` and `CACHE_VERSION = "babun-v344"`.
14. `docs/SETUP.md` documents how to obtain keys and create `.env.local` for a fresh clone.
15. `tsc --noEmit` green; Vercel deploy green (env vars added to Vercel before push).

## Why this is **not** STORY-001 redux

STORY-001 already shipped scaffolding (provider, killswitch, import UI, root migrations) — see `## Risks → R0` below. STORY-036 is **deliberately narrower**:

| Aspect | STORY-001 | STORY-036 |
|---|---|---|
| Vertical | All 9 entities | clients only |
| Backend mode toggle | yes (3 modes) | no — direct switch |
| Auth required | yes | **no** (defer to STORY-037) |
| RLS required | yes | **no** (defer to STORY-038) |
| Tenant model | `auth.tenant_id()` from JWT | hardcoded `DEV_TENANT_ID` |
| Migration path | shadow → flip | replace |

The clients-only scope keeps blast radius small and produces a copy-pastable pattern for the next 5 verticals.

## Technical plan

### G0 — Cleanup STORY-001 scaffolding (run FIRST, separate commit)

Goal: leave a clean slate before G1. Without this, the half-baked STORY-001 client and provider keep interfering with the new SSR client we install in G1.

**Files to delete:**

| Path | Reason |
|---|---|
| `babun-crm/apps/web/src/lib/supabase/backend-mode.ts` | Tri-mode killswitch obsoleted by direct migration |
| `babun-crm/apps/web/src/lib/supabase/SupabaseProvider.tsx` | React context provider — replaced by direct `getSupabaseBrowser()` calls |
| `babun-crm/apps/web/src/lib/supabase/import.ts` | localStorage→Supabase importer — we're dropping localStorage data instead |
| `babun-crm/apps/web/src/app/dashboard/settings/import/page.tsx` | UI for the dead importer above |
| `supabase/migrations/20260421000100_initial_schema.sql` | STORY-001's broader schema; conflicts with our narrower one |
| `supabase/migrations/20260421000200_rls.sql` | RLS policies for tables we're not creating |
| `supabase/migrations/20260421000300_signup_trigger.sql` | Auth signup trigger — STORY-037's job |
| `supabase/migrations/002_chats_inbox.sql` | Chats schema — out of scope this story |
| `supabase/README.md` | Stale CEO checklist; will be replaced by `docs/SETUP.md` |
| Empty `supabase/` folder at repo root | Remove if empty after the file deletes |

**Kept:** `client.ts` and `types.ts` — both get **overwritten** in G1 (not deleted, to keep import paths stable).

**Importers to fix** (3 files reference the deleted modules):

| Path | Current | After G0 |
|---|---|---|
| `babun-crm/apps/web/src/app/layout.tsx` | `import SupabaseProvider from "@/lib/supabase/SupabaseProvider"; <SupabaseProvider>{children}</SupabaseProvider>` | Drop import + provider wrap; render `{children}` directly |
| `babun-crm/apps/web/src/app/login/page.tsx` | `import { isSupabaseEnabled } from "@/lib/supabase/backend-mode";` then `if (isSupabaseEnabled()) ...` branch | Remove the import + the conditional branch; revert to the pure-stub login form (auth lands in STORY-037) |
| `babun-crm/apps/web/src/app/dashboard/settings/import/page.tsx` | Whole file | **Deleted entire route** — see table above |

**Verification step (gate before commit):**

```bash
# from babun-crm/apps/web
npx tsc --noEmit
```

If `tsc` complains about a missed importer, fix it now — don't paper over with `// @ts-ignore`.

**Commit:** `chore: cleanup STORY-001 supabase scaffolding`

### G1 — Setup

**Packages.** From `babun-crm/apps/web/`:

```bash
npm install @supabase/supabase-js @supabase/ssr
```

(`@supabase/supabase-js` is already a dep — only `@supabase/ssr` is new.)

**Env files.**

`babun-crm/apps/web/.env.local.example` (committed):

```bash
# Supabase project: qvgemicqeqwz (eu-west-1, free tier)
# Get keys from https://supabase.com/dashboard/project/qvgemicqeqwz/settings/api

# Public — sent to the browser. Safe to expose.
NEXT_PUBLIC_SUPABASE_URL=https://qvgemicqeqwz.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=

# Secret — server-side only, never NEXT_PUBLIC_
SUPABASE_SECRET_KEY=

# Dev tenant — pre-seeded in tenants table by the init migration.
# All client rows are tagged with this until STORY-037 wires real auth.
NEXT_PUBLIC_DEV_TENANT_ID=00000000-0000-0000-0000-00000000babb
```

**Naming.** Since G0 deleted the legacy `client.ts`, there's no longer a reason to support both `_PUBLISHABLE_KEY` and `_ANON_KEY`. We read **only** `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Cleaner; one less footgun.

**.gitignore check.** Both `.gitignore` files (`/`, `/babun-crm/apps/web/`) already block `.env*` / `.env*.local`. No change needed; we'll verify in the developer step.

**Interactive prompt — key handling.** Developer pauses after writing `.env.local.example` and asks the user for the Publishable key + Secret key. **Do NOT echo the values back into the terminal** — the chat transcript is persisted, an echo bakes secrets into history. The flow:

1. Developer prints exactly:
   ```
   Open https://supabase.com/dashboard/project/qvgemicqeqwz/settings/api
   Paste NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (single line):
   ```
2. User pastes one value at a time.
3. Developer writes them into `.env.local` via the Write tool (no Bash echo, no `cat`).
4. Developer prints **only**: `✅ .env.local создан (4 vars)`. No values.
5. Developer runs `git status` and confirms `.env.local` is **not** in the modified list. If it is — abort, ask user to revoke + reissue keys in Supabase Dashboard, then redo with fresh keys.

**Browser client — `apps/web/src/lib/supabase/client.ts` (overwrite existing).**

```ts
"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@babun/shared/db/database.types";

let cached: ReturnType<typeof createBrowserClient<Database>> | null = null;

export function hasSupabaseEnv(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}

export function getSupabaseBrowser() {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase env missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local."
    );
  }
  cached = createBrowserClient<Database>(url, key);
  return cached;
}
```

**Server client — `apps/web/src/lib/supabase/server.ts` (new).**

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@babun/shared/db/database.types";

export async function getSupabaseServer() {
  const cookieStore = await cookies(); // Next 16: async
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  return createServerClient<Database>(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const c of toSet) cookieStore.set(c.name, c.value, c.options);
        } catch {
          // readonly cookies in RSC — ignore, middleware refreshes
        }
      },
    },
  });
}
```

We do **not** add a `middleware.ts` in this story — there's no auth yet to refresh. Comes with STORY-037.

### G2 — SQL schema

**Location.** Per the brief: `babun-crm/apps/web/supabase/migrations/20260427000001_init_clients.sql`. **Conflict to resolve:** existing migrations live at root `supabase/migrations/`. See `R0` in Risks — proposed resolution is to **leave root migrations alone** (they're STORY-001's broader plan, currently dormant) and put STORY-036's narrower migration under `apps/web/supabase/migrations/`. This means `npx supabase` is run from `apps/web/`. If the user prefers one canonical folder, we'll fold and consolidate before applying.

**File: `babun-crm/apps/web/supabase/migrations/20260427000001_init_clients.sql`**

```sql
-- STORY-036 — Supabase foundation, clients vertical only.
-- RLS intentionally OFF here. Locked down in STORY-038.
-- Schema mirrors @babun/shared/local/clients.ts. Nested data
-- (phones, locations, notes, equipment) stays as jsonb so we
-- don't fan out into 4 satellite tables before we have to.

create extension if not exists "pgcrypto";

-- ─── Tenants ───────────────────────────────────────────────────
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  vertical text,                   -- "hvac" / "cleaning" / "salon" / ...
  created_at timestamptz not null default now()
);

-- Seed the dev tenant so the app has a concrete tenant_id to write
-- against until STORY-037 introduces real auth.
insert into public.tenants (id, name, vertical)
values (
  '00000000-0000-0000-0000-00000000babb',
  'Babun Dev',
  'hvac'
);

-- ─── Client tags ───────────────────────────────────────────────
create table public.client_tags (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  color text not null
);

create index client_tags_tenant_idx on public.client_tags(tenant_id);

-- ─── Clients ───────────────────────────────────────────────────
-- Field set mirrors @babun/shared/local/clients.ts → Client interface.
-- Nested fields (phones, locations, notes, equipment) live in jsonb.
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  full_name text not null,
  phone text not null default '',
  whatsapp_phone text not null default '',
  email text not null default '',
  sms_name text not null default '',
  telegram_username text not null default '',
  instagram_username text not null default '',

  -- Money / commercial
  balance numeric(12,2) not null default 0,
  discount int not null default 0 check (discount between 0 and 100),

  -- Free text
  comment text not null default '',

  -- Acquisition
  acquisition_source text not null default 'unknown',
  referred_by_client_id uuid references public.clients(id) on delete set null,
  first_contact_date date,

  -- Address (legacy single — kept until full migration to locations)
  address text not null default '',
  city text not null default '',
  property_type text not null default '',

  -- Per-client metadata
  language text,
  birthday text not null default '',
  blacklisted boolean not null default false,
  pinned_at timestamptz,
  reminder_at timestamptz,

  -- Nested arrays — see ClientPhone / Location / ClientNote / ACUnit in clients.ts
  phones jsonb not null default '[]'::jsonb,
  locations jsonb not null default '[]'::jsonb,
  notes jsonb not null default '[]'::jsonb,
  equipment jsonb not null default '[]'::jsonb,  -- legacy; kept to mirror local model

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index clients_tenant_idx on public.clients(tenant_id);
create index clients_tenant_full_name_idx on public.clients(tenant_id, full_name);
create index clients_tenant_phone_idx on public.clients(tenant_id, phone);

-- ─── Client tag assignments (junction) ─────────────────────────
create table public.client_tag_assignments (
  client_id uuid not null references public.clients(id) on delete cascade,
  tag_id uuid not null references public.client_tags(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  primary key (client_id, tag_id)
);

create index client_tag_assignments_tenant_idx
  on public.client_tag_assignments(tenant_id);

-- ─── Default tags for the dev tenant ───────────────────────────
insert into public.client_tags (tenant_id, name, color) values
  ('00000000-0000-0000-0000-00000000babb', 'VIP',         '#f59e0b'),
  ('00000000-0000-0000-0000-00000000babb', 'Постоянный',  '#10b981'),
  ('00000000-0000-0000-0000-00000000babb', 'Новый',       '#3b82f6'),
  ('00000000-0000-0000-0000-00000000babb', 'Проблемный',  '#ef4444');

-- ─── updated_at trigger ────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

-- NOTE: RLS is intentionally NOT enabled. STORY-038 will:
--   alter table public.tenants enable row level security;
--   alter table public.clients enable row level security;
--   alter table public.client_tags enable row level security;
--   alter table public.client_tag_assignments enable row level security;
-- and create per-table policies based on auth.tenant_id().
```

**Apply — explicit fallback ladder.**

Run from `babun-crm/apps/web/`. **Never** from repo root (the dormant root migrations would also be picked up).

1. **Try CLI link.** `npx supabase link --project-ref qvgemicqeqwz`
   - If success → step 2.
   - If fail (any error: network, login, auth) → jump to step 3.
2. **Try CLI push.** `npx supabase db push`
   - If success → confirm with `select count(*) from public.tenants;` (should return 1) via Dashboard, then proceed to G3.
   - If fail → jump to step 3.
3. **Manual fallback (Dashboard).** Print the entire migration SQL into chat with a copy-paste header:

   ```
   ⚠️ CLI failed: <error>
   Apply manually:
   1. Open https://supabase.com/dashboard/project/qvgemicqeqwz/sql/new
   2. Paste the SQL below
   3. Click Run
   4. Verify: SELECT count(*) FROM public.tenants;  -- expect 1
   5. Reply "applied" in chat to continue.
   ```

4. **Wait for user confirmation** (`applied` / `ок` / etc.) before moving on. Do not assume.

### G3 — Generated types

`babun-crm/apps/web/package.json` — add to `scripts`:

```json
"db:types": "supabase gen types typescript --project-id qvgemicqeqwz > ../../packages/shared/src/db/database.types.ts"
```

Run `npm run db:types` from `apps/web/`. Output lands at `packages/shared/src/db/database.types.ts`.

Then audit `packages/shared/src/db/types/index.ts` — manual types written before this story may diverge from generated reality. Patch `index.ts` to **re-export** the generated `Tables<'clients'>` shape and remove conflicting hand-written interfaces; or keep manual types narrow and document the divergence in a comment. The repository pattern in G4 will use the **generated** Database type so we don't have to choose forever.

### G4 — Repository pattern

**File: `babun-crm/apps/web/packages/shared/src/db/repositories/clients.ts` (new).**

Wait — `packages/shared/src/db/repositories/clients.ts`. Path is from monorepo root: `babun-crm/packages/shared/src/db/repositories/clients.ts`.

**Public function signatures:**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import type { Client } from "@babun/shared/local/clients";

type DbSupabase = SupabaseClient<Database>;
type ClientRow = Database["public"]["Tables"]["clients"]["Row"];
type ClientInsert = Database["public"]["Tables"]["clients"]["Insert"];

export async function listClients(
  supabase: DbSupabase,
  tenantId: string,
): Promise<Client[]>;

export async function getClient(
  supabase: DbSupabase,
  id: string,
  tenantId: string,
): Promise<Client | null>;

export async function createClient(
  supabase: DbSupabase,
  input: Client,
  tenantId: string,
): Promise<Client>;

export async function updateClient(
  supabase: DbSupabase,
  id: string,
  patch: Partial<Client>,
  tenantId: string,
): Promise<Client>;

export async function deleteClient(
  supabase: DbSupabase,
  id: string,
  tenantId: string,
): Promise<void>;
```

All five filter by `tenant_id` explicitly until STORY-038 enables RLS.

**Adapter — `rowToClient` (DB → local UI shape).** Round-trip-safe: every UI field has either a column or a jsonb slot. Never throws — bad jsonb falls back to empty array.

```ts
import type { Client, PhoneEntry, Location, ClientNote, ACUnit, AcquisitionSource, PropertyType }
  from "@babun/shared/local/clients";

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export function rowToClient(r: ClientRow): Client {
  return {
    id: r.id,
    full_name: r.full_name,
    phone: r.phone,
    whatsapp_phone: r.whatsapp_phone,
    email: r.email,
    sms_name: r.sms_name,
    telegram_username: r.telegram_username,
    instagram_username: r.instagram_username,

    balance: Number(r.balance ?? 0),
    discount: r.discount ?? 0,
    comment: r.comment,

    acquisition_source: (r.acquisition_source ?? "unknown") as AcquisitionSource,
    referred_by_client_id: r.referred_by_client_id,
    first_contact_date: r.first_contact_date,

    address: r.address,
    city: r.city,
    property_type: (r.property_type ?? "") as PropertyType | "",

    language: r.language ?? "",
    birthday: r.birthday,
    blacklisted: r.blacklisted,
    pinned_at: r.pinned_at,
    reminder_at: r.reminder_at,

    // Nested jsonb arrays.
    phones: asArray<PhoneEntry>(r.phones).map((p) => ({
      id: p.id,
      number: p.number,
      label: p.label,
      name: p.name,
    })),
    locations: asArray<Location>(r.locations).map((l) => ({
      id: l.id,
      label: l.label,
      address: l.address,
      mapUrl: l.mapUrl,
      isPrimary: l.isPrimary,
      note: l.note,
      equipment: asArray<ACUnit>(l.equipment).map((u) => ({
        id: u.id,
        room: u.room,
        brand: u.brand,
        model: u.model,
        ac_type: u.ac_type ?? "split",
        has_indoor: u.has_indoor ?? true,
        has_outdoor: u.has_outdoor ?? true,
      })),
    })),
    notes: asArray<ClientNote>(r.notes).map((n) => ({
      id: n.id,
      text: n.text,
      created_at: n.created_at,
    })),
    equipment: asArray<ACUnit>(r.equipment).map((u) => ({
      id: u.id,
      room: u.room,
      brand: u.brand,
      model: u.model,
      ac_type: u.ac_type ?? "split",
      has_indoor: u.has_indoor ?? true,
      has_outdoor: u.has_outdoor ?? true,
    })),

    // tag_ids: filled by a parallel query against client_tag_assignments
    // (see listClients implementation below).
    tag_ids: [],

    created_at: r.created_at,
  };
}
```

**Adapter — `clientToInsert` (local UI shape → DB insert).** UI-only computed fields (`tag_ids` — lives in junction; segmentation cache; etc.) are stripped. Booleans/numbers default to safe values that match column defaults.

```ts
function clientToInsert(c: Client, tenantId: string): ClientInsert {
  return {
    id: c.id || undefined,                  // let DB default if empty
    tenant_id: tenantId,
    full_name: c.full_name,
    phone: c.phone ?? "",
    whatsapp_phone: c.whatsapp_phone ?? "",
    email: c.email ?? "",
    sms_name: c.sms_name ?? "",
    telegram_username: c.telegram_username ?? "",
    instagram_username: c.instagram_username ?? "",

    balance: c.balance ?? 0,
    discount: c.discount ?? 0,
    comment: c.comment ?? "",

    acquisition_source: c.acquisition_source ?? "unknown",
    referred_by_client_id: c.referred_by_client_id ?? null,
    first_contact_date: c.first_contact_date ?? null,

    address: c.address ?? "",
    city: c.city ?? "",
    property_type: c.property_type || "",

    language: c.language ?? null,
    birthday: c.birthday ?? "",
    blacklisted: c.blacklisted ?? false,
    pinned_at: c.pinned_at ?? null,
    reminder_at: c.reminder_at ?? null,

    // Nested arrays — pass through as-is; DB column is jsonb.
    phones: c.phones ?? [],
    locations: c.locations ?? [],
    notes: c.notes ?? [],
    equipment: c.equipment ?? [],

    // Preserve the moment the form was created. If empty (legacy or
    // hand-built objects) fall back to DB default `now()`.
    created_at: c.created_at || undefined,
    // updated_at: handled by trigger
  };
}
```

**Tag round-trip.** Tags live in a separate `client_tag_assignments` junction. `listClients` does:

```ts
const { data: rows } = await supabase
  .from("clients")
  .select("*")
  .eq("tenant_id", tenantId);

const { data: assigns } = await supabase
  .from("client_tag_assignments")
  .select("client_id, tag_id")
  .eq("tenant_id", tenantId);

const tagsByClient = new Map<string, string[]>();
for (const a of assigns ?? []) {
  const arr = tagsByClient.get(a.client_id) ?? [];
  arr.push(a.tag_id);
  tagsByClient.set(a.client_id, arr);
}

return (rows ?? []).map((r) => ({
  ...rowToClient(r),
  tag_ids: tagsByClient.get(r.id) ?? [],
}));
```

`getClient` does the single-row variant:

```ts
const { data: row } = await supabase
  .from("clients")
  .select("*")
  .eq("id", id)
  .eq("tenant_id", tenantId)
  .maybeSingle();
if (!row) return null;

const { data: assigns } = await supabase
  .from("client_tag_assignments")
  .select("tag_id")
  .eq("client_id", id)
  .eq("tenant_id", tenantId);

return { ...rowToClient(row), tag_ids: (assigns ?? []).map((a) => a.tag_id) };
```

`createClient` and `updateClient` do the inverse: after the upsert, diff `tag_ids` against current junction rows for that client and `delete` removed ones + `insert` new ones in one round-trip.

**Round-trip lossless?** Yes — every field on the local `Client` interface has a column or jsonb slot, with full audit table reviewed against `packages/shared/src/local/clients.ts`. Two **edge cases** are documented (not data loss, but worth knowing):

1. **`referred_by_client_id` cascade.** FK is `on delete set null` — if the referenced client is deleted, the field becomes `null`. localStorage today leaves stale IDs pointing at deleted clients; Supabase cleans them up. Net: **correctness win, not a drop**.
2. **`balance` precision.** Local `number` (IEEE 754) → DB `numeric(12,2)` rounds to 2 decimals. All real balances are already to-the-cent, so this fixes floating-point drift rather than losing data.

`equipment` (deprecated top-level field on `Client`) is preserved verbatim in its own jsonb column. The local code already auto-migrates it into `locations[primary].equipment` on read; we keep both until appointments + finance also land on Supabase, then drop the legacy column in a follow-up migration.

**`DEV_TENANT_ID` constant** — `babun-crm/packages/shared/src/db/constants.ts`:

```ts
export const DEV_TENANT_ID = "00000000-0000-0000-0000-00000000babb";
```

UI code reads it via `process.env.NEXT_PUBLIC_DEV_TENANT_ID ?? DEV_TENANT_ID`.

### G5 — UI adapter (clients vertical only)

**The change is centralized in `app/dashboard/layout.tsx`,** not in the three pages — `useClients()` lives there and feeds clients/page.tsx, [id]/page.tsx, new/page.tsx, plus appointment forms, calendar tooltips, etc. Touching the layout's clients block is enough.

In `apps/web/src/app/dashboard/layout.tsx`:

- Replace the synchronous `useState(() => loadClients())` for clients (and tags) with `useState<Client[] | null>(null) + useEffect(async load)`.
- Distinguish 3 states: `null` = loading → render skeleton; `[]` with `error` set → render error banner with retry; populated → render list.
- Persist to Supabase via `createClient/updateClient/deleteClient` instead of `saveClients(...)`.
- Keep the existing `babun:clients-changed` event-bus pattern so `ClientPickerSheet` etc. still get refreshed lists; the listener now triggers `listClients` re-fetch instead of `loadClients`.
- Drop the `loadClientTags`/`saveClientTags` localStorage round-trip in favor of `client_tags` table CRUD (same repo file).

**Loading state.** New component `apps/web/src/components/clients/ClientsListSkeleton.tsx` — lightweight shimmer rows so /dashboard/clients doesn't flash empty.

**Error state.** Inline banner above the list with retry button that re-runs `listClients`.

**The three pages themselves require minimal change** — they already consume `useClients()`. `clients/new/page.tsx` calls `addClient(...)` from the context — we make that internally async and `await` it.

**Out of scope in G5:** appointments / finance / chats / waitlist still call `useAppointments()` / `useExpenses()` / etc. which still hit localStorage. Those stay unchanged this story.

### G5.5 — Manual smoke-test (gate before G6)

**Mandatory.** If any step fails, **do not commit, do not bump versions, do not push**. Report the failure in chat with the exact error.

| # | Step | Expected | If fails |
|---|---|---|---|
| 1 | `npm run dev` from `apps/web/`, open `http://localhost:3001/dashboard/clients` | List renders (skeleton briefly, then empty list since DB only has dev tenant + zero clients) | Check Network tab → 401/403 means RLS still on; 500 means schema mismatch |
| 2 | Click "Новый клиент", enter name + phone, save | Redirect back to list, new client visible | Check Console for repository errors |
| 3 | Open Supabase Dashboard → Table Editor → `clients` | One row, `tenant_id = 00000000-0000-0000-0000-00000000babb`, all your input | If row missing → repo `createClient` not awaited or wrong tenant |
| 4 | Open the new client in UI, add a `Location` (label + address) and a `Note`, save | Both appear after re-render | nested jsonb adapter regression |
| 5 | In Supabase, refresh the row | `locations` jsonb has the new entry; `notes` jsonb has the new note | adapter loses fields (R7) |
| 6 | Edit `phone` on the same client, save | Updates locally + in DB | `updated_at` trigger should advance |
| 7 | Delete the client via UI | Disappears from list | Verify DB row gone (or appointments fk set null — N/A this story) |
| 8 | Throttle Network → "Offline" in DevTools, refresh page | Skeleton → error banner with retry button | If white screen → loading state missing |
| 9 | Network back online, click retry | List loads | retry handler not wired |

Only after all 9 pass → proceed to G6.

### G6 — Bump + docs + push

**Version bumps.**
- `apps/web/src/app/dashboard/page.tsx` → `BUILD_VERSION = "v344-supabase-clients"`
- `apps/web/public/sw.js` → `CACHE_VERSION = "babun-v344"`

**No-index meta tag (until STORY-038 lands).** In `apps/web/src/app/layout.tsx`, add inside the `<head>`:

```tsx
{/* TODO: remove after STORY-038 wires RLS — DB is publicly readable until then */}
<meta name="robots" content="noindex, nofollow" />
```

**Root README.md warning.** Prepend at the very top of `README.md`:

```md
> ⚠️ **WARNING — DB is publicly readable until STORY-038**
>
> Babun is currently running on a Supabase project **without RLS enabled** and
> with the publishable key in the browser bundle. Anyone who can reach
> `babun2.vercel.app` can `select *` from the `clients` table.
>
> **Until STORY-038 lands:**
> - Do NOT share the production URL publicly.
> - Do NOT post the publishable key (or any screenshot containing it) anywhere.
> - Treat the deployed instance as private dev.
```

**`docs/SETUP.md`** — new file with these sections, in this order:

1. **⚠️ SECURITY WARNING** (same wording as README, identical block, top of file).
2. **Prerequisites** — Node 20+, npm 11+, a Supabase account with access to project `qvgemicqeqwz`.
3. **Local setup** — clone, `npm install` from repo root, copy `.env.local.example` → `.env.local`, paste keys (link to Supabase Dashboard API page).
4. **Generating types** — `cd babun-crm/apps/web && npm run db:types`.
5. **Run dev** — `cd babun-crm/apps/web && npm run dev` → `http://localhost:3001`.
6. **Migrations** — only ever run `supabase` CLI from `babun-crm/apps/web/` (never from repo root); link command + push command + manual fallback.
7. **Vercel Production Setup**:
   1. Vercel Dashboard → Project `babun2` → Settings → Environment Variables.
   2. Add four variables (one row each):
      - `NEXT_PUBLIC_SUPABASE_URL`
      - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
      - `SUPABASE_SECRET_KEY` — **mark as Sensitive** (toggle the "Sensitive" checkbox so it's hidden from the UI after save).
      - `NEXT_PUBLIC_DEV_TENANT_ID` (value: `00000000-0000-0000-0000-00000000babb`).
   3. Each one: enable **Production**, **Preview**, **Development** environments.
   4. Save → trigger Redeploy from the Deployments tab (or push a no-op commit).
   5. Verify: open `https://babun2.vercel.app/dashboard/clients` — list should load from Supabase.
8. **Troubleshooting** — common errors (`Supabase env missing`, RLS denying, network).

**Pre-push key-leak gate (mandatory before any `git add` in G6):**

```bash
git status            # human-readable scan
git status --short    # one-liner check
```

Look for `.env.local` or any `.env` file other than `.env.local.example` in the modified/untracked list. If present:

1. **Stop**. Do not proceed.
2. Print to chat (verbatim):
   ```
   🚨 .env.local показался в git status. Возможная утечка ключей.
   1. Зайди в https://supabase.com/dashboard/project/qvgemicqeqwz/settings/api
   2. Revoke текущий Publishable + Secret keys
   3. Создай новые
   4. Перезапиши .env.local + Vercel env vars новыми значениями
   5. Подтверди в чате — продолжим
   ```
3. Wait for explicit user confirmation before resuming.

If `git status` is clean of env files, proceed with `git add <specific paths>` (never `git add -A` or `git add .`).

## Files touched

### Create

| Path | Purpose |
|---|---|
| `babun-crm/apps/web/.env.local.example` | Template for required env vars |
| `babun-crm/apps/web/supabase/config.toml` | Created by `supabase link` (auto) |
| `babun-crm/apps/web/supabase/migrations/20260427000001_init_clients.sql` | Schema (tenants, clients, client_tags, junction) + dev tenant seed |
| `babun-crm/apps/web/src/lib/supabase/server.ts` | SSR client (Next 16 async cookies) |
| `babun-crm/apps/web/src/components/clients/ClientsListSkeleton.tsx` | Loading shimmer |
| `babun-crm/packages/shared/src/db/database.types.ts` | Output of `npm run db:types` |
| `babun-crm/packages/shared/src/db/constants.ts` | `DEV_TENANT_ID` constant |
| `babun-crm/packages/shared/src/db/repositories/clients.ts` | CRUD functions for clients + tags |
| `docs/SETUP.md` | Local-dev setup guide + Vercel production setup + security warning |
| `babun-crm/apps/web/.env.local` | **Local only — never committed.** Created interactively by the user during G1 |

### Modify

| Path | Change |
|---|---|
| `babun-crm/apps/web/package.json` | Add `@supabase/ssr` dep, `db:types` script |
| `babun-crm/apps/web/src/lib/supabase/client.ts` | Replace with `@supabase/ssr` `createBrowserClient`; reads only `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| `babun-crm/apps/web/src/lib/supabase/types.ts` | Thin re-export of generated `Database` |
| `babun-crm/packages/shared/src/db/index.ts` | Re-export repositories + `DEV_TENANT_ID` |
| `babun-crm/apps/web/src/app/layout.tsx` | (G0) drop `SupabaseProvider` wrap. (G6) add `<meta name="robots" content="noindex, nofollow" />` |
| `babun-crm/apps/web/src/app/login/page.tsx` | (G0) drop `isSupabaseEnabled` branch — back to pure stub |
| `babun-crm/apps/web/src/app/dashboard/layout.tsx` | Switch clients + client_tags from `loadClients/saveClients` to repository calls; add loading + error state |
| `babun-crm/apps/web/src/app/dashboard/clients/page.tsx` | Render skeleton when clients are loading; render error banner with retry |
| `babun-crm/apps/web/src/app/dashboard/clients/new/page.tsx` | Await async create |
| `babun-crm/apps/web/src/app/dashboard/clients/[id]/page.tsx` | Await async update / delete |
| `babun-crm/apps/web/src/app/dashboard/page.tsx` | `BUILD_VERSION = "v344-supabase-clients"` |
| `babun-crm/apps/web/public/sw.js` | `CACHE_VERSION = "babun-v344"` |
| `README.md` (repo root) | Prepend security warning block |

### Delete (G0)

| Path | Reason |
|---|---|
| `babun-crm/apps/web/src/lib/supabase/backend-mode.ts` | Tri-mode killswitch obsoleted |
| `babun-crm/apps/web/src/lib/supabase/SupabaseProvider.tsx` | Provider replaced by direct `getSupabaseBrowser()` |
| `babun-crm/apps/web/src/lib/supabase/import.ts` | localStorage importer not needed (data is throwaway) |
| `babun-crm/apps/web/src/app/dashboard/settings/import/page.tsx` | UI for the dead importer |
| `supabase/migrations/20260421000100_initial_schema.sql` | STORY-001's broader schema; conflicts |
| `supabase/migrations/20260421000200_rls.sql` | RLS for tables we're not creating |
| `supabase/migrations/20260421000300_signup_trigger.sql` | Auth signup trigger — STORY-037 territory |
| `supabase/migrations/002_chats_inbox.sql` | Chats schema — out of scope |
| `supabase/README.md` | Stale; replaced by `docs/SETUP.md` |
| `supabase/` (folder, if empty) | Cleanup |

## Out of scope (next stories)

- **STORY-037** — Supabase Auth (email + magic link), `auth.users` ↔ `tenants` link
- **STORY-038** — RLS policies on every tenant-scoped table; `auth.tenant_id()` helper; cross-tenant isolation test
- **STORY-036b** — Migrate appointments to Supabase
- **STORY-036c** — Migrate finance (income, expenses, payroll, reports)
- **STORY-036d** — Migrate schedule, services, masters, sms-templates, chats
- **STORY-036e** — Onboarding wizard for fresh signups (delete dev tenant, create real one)
- **STORY-036f** — Realtime subscriptions for clients (Supabase Realtime channel) — deferred until base CRUD is solid
- IndexedDB offline outbox / write-through cache (was STORY-001b)

## Risks

**R0 — STORY-001 scaffolding interference (HIGH → resolved by G0).** The repo had a partial Supabase build from STORY-001. **G0 wipes it** as the first commit: deletes `backend-mode.ts`, `SupabaseProvider.tsx`, `import.ts`, the import-route page, and root `/supabase/migrations/*.sql`. After G0 there is no name collision and `client.ts` is reset to a clean `@supabase/ssr` browser client in G1. CLI is still run from `apps/web/` to keep the migration path scoped to one folder.

**R1 — Loading flicker.** Pages that previously rendered synchronously now wait on a network round-trip. Mitigated by skeleton state + the existing dashboard provider tree (clients is one of ~12 contexts; only this one becomes async — others stay sync).

**R2 — Vercel build breaks without env vars.** Adding env vars to Vercel **before** push is on the user — we'll display the exact 4 var names as the last reminder before the developer commits.

**R3 — Type drift.** Hand-written `db/types/index.ts` from STORY-035 conflicts with generated `database.types.ts`. Resolution in G3: generated wins, manual file becomes thin re-export; document the convention in a header comment.

**R4 — Local data wipe.** Brief explicitly says the existing localStorage data is throwaway. Confirm in G1: developer prints a list of localStorage keys that will become stale and asks the user to acknowledge before proceeding.

**R5 — `@supabase/ssr` install failure on Windows.** Native deps on this combo (Node 20 + npm 11 + Windows) occasionally fail. Fallback: switch to `@supabase/supabase-js`-only browser client and skip `server.ts` (the server client isn't yet exercised in the clients-only scope).

**R6 — RLS-off means `tenant_id` is enforceable only via the repository.** Anyone with the publishable key can issue `select * from clients` and see every tenant's data. **Mitigation in G6:** robots noindex meta in `app/layout.tsx`, red warning in `README.md` and `docs/SETUP.md` top, mark `SUPABASE_SECRET_KEY` as Sensitive in Vercel. **Gate:** before STORY-037 onboards a second user, STORY-038 (RLS) must land.

**R7 — Two `Client` types in flight.** `@babun/shared/local/clients` (rich, with phones[], locations[], etc.) is the UI shape. `Database['public']['Tables']['clients']['Row']` is the DB shape (jsonb columns). The repository's `rowToClient` adapter is the ONE place that bridges them — keep it tested. Add a TODO in the file pointing at the planned shared type.

## Working order

1. **architect** (this file) → user reads, says "ок" / "делай".
2. **developer**:
   - **G0** — delete STORY-001 artefacts; fix the 3 stale importers (`app/layout.tsx`, `login/page.tsx`, delete `dashboard/settings/import/page.tsx`); `tsc` green. **Commit:** `chore: cleanup STORY-001 supabase scaffolding`.
   - **G1** — install deps; write `.env.local.example`; **stop and prompt user for keys interactively (no echo)**; write `.env.local`; verify `git status` clean of env files; rewrite `client.ts` + add `server.ts`. Commit.
   - **G2** — write migration; CLI link → push (with explicit fallback to Dashboard SQL Editor); wait for user confirmation that migration applied. Commit.
   - **G3** — `npm run db:types`; reconcile `packages/shared/src/db/types/index.ts` against generated types. Commit.
   - **G4** — repository file with full `rowToClient` / `clientToInsert` adapters + tag-junction round-trip + `DEV_TENANT_ID` constant. Commit.
   - **G5** — layout switch + loading skeleton + error banner; thin async wrappers in the 3 client pages. Commit.
   - **G5.5** — manual smoke-test (9 steps). **Gate**: do not proceed unless all 9 pass.
   - **G6** — `BUILD_VERSION` + `CACHE_VERSION` bumps; add `<meta name="robots" content="noindex">` to `app/layout.tsx`; write `docs/SETUP.md` (with Vercel section); prepend warning to root `README.md`; remind user to add 4 Vercel env vars (with `SUPABASE_SECRET_KEY` marked Sensitive); pre-push `git status` env-leak gate; commit; push.
3. **reviewer** — `git diff master`; specific checks:
   - no `any`, no `@ts-ignore`
   - no import of `SUPABASE_SECRET_KEY` from any `app/` or `components/` file (browser bundle leak)
   - layout async clients hook doesn't deadlock the other 11 contexts (they should still render sync while clients loads)
   - tenant filter on every repository call (no `.from("clients").select()` without `.eq("tenant_id", ...)`)
   - skeleton + error states actually render
   - `.env.local` is not in the diff
   - `<meta robots noindex>` is in `app/layout.tsx` head

## Constraints (reminders)

- Max 400 lines per component.
- TypeScript strict; **no `any`**.
- Don't touch ServiceWorkerRegister, swipe / pinch / `touch-action`, calendar code, appointments / finance / chats data layers.
- RLS stays OFF — that's STORY-038.
- One logical commit per group (G1..G6).
- RU in UI strings, EN in code.
