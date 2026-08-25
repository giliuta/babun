// db namespace — Supabase-shape types and the generated Database type.
//
// Generated DB shape lives in `./database.types` (regenerated via
// `apps/web/npm run db:types`). Hand-written domain types for the
// finance vertical live under `./types/finance` and stay until that
// vertical is migrated to Supabase (later sub-story of STORY-036).
//
// The hand-written stubs in `./types/index.ts` (Profile, Team, Client,
// Service, Appointment, …) are obsoleted by `./database.types.ts` and
// not re-exported here. Direct importers of `@babun/shared/db/types/finance`
// keep working.

export type { Database, Json } from "./database.types";
export { DEV_TENANT_ID } from "./constants";
