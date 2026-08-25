// Dev-tenant constant used until STORY-037 wires real auth +
// resolves tenant_id from the authenticated user's metadata.
//
// The matching row is seeded by
//   apps/web/supabase/migrations/20260427_001_init_clients.sql
//
// Browser/UI code can override this via env (so a future preview
// build could point at a different seeded tenant if needed):
//   process.env.NEXT_PUBLIC_DEV_TENANT_ID

export const DEV_TENANT_ID = "00000000-0000-0000-0000-00000000babb";
