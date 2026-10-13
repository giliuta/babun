import type { Database } from "@babun/shared/db/database.types";
import type { BrigadeMember, BrigadeRole } from "@babun/shared/local/masters";

export type Tables = Database["public"]["Tables"];
export type Team = Tables["teams"]["Row"];
export type Master = Tables["masters"]["Row"];
export type City = Tables["cities"]["Row"];

// ─── jsonb → typed casts (safe on []/null/{}) ────────────────────────
// teams.roles / teams.members / teams.cities round-trip through Postgres
// jsonb, so Supabase types them as `Json`. These narrow them back to the
// shared domain shapes without ever throwing on empty/null/garbage — a
// legacy team with `'[]'::jsonb` (or a NULL that slipped through) yields
// an empty array, never a crash (RISK-1).

// Both casts below are needed: Json is not comparable to the domain interfaces.
export function teamRoles(t: Team): BrigadeRole[] {
  return Array.isArray(t.roles) ? (t.roles as unknown as BrigadeRole[]) : [];
}

export function teamMembers(t: Team): BrigadeMember[] {
  return Array.isArray(t.members)
    ? (t.members as unknown as BrigadeMember[])
    : [];
}

export function teamCities(t: Team): string[] {
  return Array.isArray(t.cities)
    ? (t.cities as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
}
