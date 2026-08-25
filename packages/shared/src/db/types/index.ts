// Domain-specific Supabase shapes that aren't expressed in the
// generated `database.types` (e.g. computed money types, derived
// interfaces). For now this is just a re-export of the finance domain
// — extend as more verticals migrate to Supabase.
//
// The wide hand-written stubs that used to live here (Profile, Team,
// Client, Service, Appointment, Transaction, Message, Conversation,
// SmsTemplate, CallLog, TeamLocation) were replaced by the generated
// `Database` type at packages/shared/src/db/database.types.ts as part
// of STORY-036. Direct importers of those names have been migrated
// to either `@babun/shared/local/*` (UI shape) or
// `Database['public']['Tables'][...]` (DB row shape).

export * from "./finance";
