-- ─────────────────────────────────────────────────────────────────────
-- STORY-074 — Tenant brand + region settings.
--
-- Single migration that adds everything an owner is asked at the
-- "hard setup" stage so we don't keep poking schema for every new
-- field. Grouped:
--
--   * Region / billing prefs
--       country           — ISO-3166 alpha-2, default CY (Cyprus launch)
--       currency          — display ccy for finances + SMS pricing
--   * Public contacts (shown in SMS signature, online booking page,
--     invoice PDFs once those are migrated to Supabase)
--       contact_phone, contact_email, contact_whatsapp,
--       contact_telegram, contact_instagram, business_address
--   * Branding
--       logo_url          — Supabase Storage URL or external CDN
--       booking_slug      — unique handle for /book/<slug> (STORY-004
--                            online booking will land later; column
--                            kept ready so we don't need another
--                            migration when the route ships).
-- ─────────────────────────────────────────────────────────────────────

alter table public.tenants
  add column if not exists country text not null default 'CY',
  add column if not exists currency text not null default 'EUR'
    check (currency in ('EUR', 'USD', 'RUB', 'UAH', 'GBP')),
  add column if not exists booking_slug text,
  add column if not exists logo_url text,
  add column if not exists business_address text,
  add column if not exists contact_phone text,
  add column if not exists contact_email text,
  add column if not exists contact_whatsapp text,
  add column if not exists contact_telegram text,
  add column if not exists contact_instagram text;

-- Unique index on booking_slug — partial so existing rows with NULL
-- don't all collide. Once an owner sets a slug it becomes globally
-- unique across the platform (i.e. babun.app/book/<slug> resolves
-- to exactly one tenant).
create unique index if not exists tenants_booking_slug_unique
  on public.tenants(booking_slug)
  where booking_slug is not null;

comment on column public.tenants.country is
  'STORY-074 — ISO-3166 alpha-2 country code. Drives default '
  'currency, default cities seed, default time zone.';

comment on column public.tenants.currency is
  'STORY-074 — display currency for finances + SMS pricing. '
  'Stripe billing is always EUR (the platform billing currency); '
  'this only affects what the tenant sees in their dashboard.';

comment on column public.tenants.booking_slug is
  'STORY-074 — globally unique handle reserved for the future '
  '/book/<slug> public booking page (STORY-004). Owner-edited via '
  'Settings → Бренд. Letters / digits / hyphens, max 32 chars.';

comment on column public.tenants.logo_url is
  'STORY-074 — public URL of the company logo. Used in SMS signature, '
  'invoice header, and the future online-booking landing page.';
