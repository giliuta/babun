// Clients repository — STORY-036 / STORY-038.
//
// Single bridge between the UI shape (`@babun/shared/local/clients`
// → `Client`) and the Supabase row shape (`Database['public']
// ['Tables']['clients']['Row']`). Every nested array field on the
// local Client lives in jsonb on the DB; the adapters below are the
// only place that knows the column ↔ field mapping.
//
// Tag membership is stored in the `client_tag_assignments` junction
// table; the repository hides this from callers — `Client.tag_ids`
// round-trips losslessly via a parallel query.
//
// STORY-038 — every function in this file expects a Supabase client
// authenticated as either `anon` (no session) or `authenticated`
// (session cookie). RLS keys off public.current_tenant_id() which
// reads JWT app_metadata.tenant_id (with a tenants-by-owner_user_id
// fallback for the fresh-signup race). The explicit `.eq('tenant_id',
// tenantId)` filter below is now redundant for security but kept as
// belt-and-suspenders + helps PostgREST pick a faster index path.
// Service role bypass is intentionally out of scope; admin/cron
// tasks live outside this module (none yet).
//
// The implementation lives in ./clients/: mappers, reads (paging), writes,
// errors (refusals in words) and tags.

export { rowToClient, clientToInsert, clientToUpdate } from "./clients/mappers";
export { clientWriteRefusal } from "./clients/errors";
export {
  listClients,
  listClientsWithStamps,
  getClient,
  findClientByPhoneE164,
} from "./clients/reads";
export {
  createClient,
  updateClient,
  renameClientCity,
  deleteClient,
  TRASH_DAYS,
  purgeDateFromNow,
  softDeleteClient,
  restoreClient,
} from "./clients/writes";
export {
  listClientTags,
  createClientTag,
  updateClientTag,
  deleteClientTag,
} from "./clients/tags";
