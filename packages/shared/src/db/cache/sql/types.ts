// Row shapes stored in the SQLite cache `data` column.

import type { Client } from "../../../local/clients";
import type { Appointment } from "../../../local/appointments";
import type { CachedAppointment, CachedClient, CachedTag } from "../index";

// ─── Cache-of-DOMAIN row shapes (slice 5) ─────────────────────────────
// The `data` column is opaque JSON — the SQL layer only ever reads the
// denormalised keys (`id`, `tenant_id`, `updated_at`, `date`) off the
// top level to fill the indexed columns; the rest round-trips untouched.
//
// Slice 5 fix: the cached-wrappers now store the FULL DOMAIN object (the
// same shape `repositories/*.list*` return — `Client` WITH `tag_ids`,
// `Appointment` with nested arrays) instead of the raw DB Row. That keeps
// online reads-from-cache byte-identical to a live repo read (no `tag_ids`
// regression, no emptied nested fields). To satisfy the SQL layer's
// denorm-key extraction + the tenant-scoped reads, the stored object is the
// domain object DECORATED with the two bookkeeping keys the domain shape
// itself doesn't carry (`tenant_id`; `updated_at` for clients — Appointment
// already has `updated_at` + `date`).
//
// The queue PAYLOAD is a DIFFERENT projection (raw DB columns the server
// accepts) and is built separately in the wrappers — see the "two
// projections" note there. These types describe only what lands in `data`.
export type CachedClientData = Client & {
  tenant_id: string;
  updated_at: string;
};
export type CachedAppointmentData = Appointment & {
  tenant_id: string;
};

// Anything the cache can store in `data`. The write/read APIs accept the
// domain-decorated shapes (slice 5) as well as the raw Row shapes still
// used by a few tests + the replayer's canonical-row write-through. All
// that matters at this layer is the presence of the denorm keys, which
// every member carries.
export type CachedRow =
  | CachedClient
  | CachedAppointment
  | CachedTag
  | CachedClientData
  | CachedAppointmentData;
