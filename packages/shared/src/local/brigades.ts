// Finance brigades data layer.
//
// A Brigade is the finance-layer representation of a field team.
// Separate from masters.ts Team (which drives the calendar/UI);
// this module owns payroll identity, outsource cost, and brigade membership.

import { generateId } from "./masters";
import type { Brigade, BrigadeMember } from "@babun/shared/db/types/finance";

export type { Brigade, BrigadeMember };

// ─── Seed data ─────────────────────────────────────────────────────────

const NOW = new Date().toISOString();

/** euro-cents: €1000 = 100000 */
const BASE_SALARY_CENTS = 100_000;

export const DEFAULT_BRIGADES: Brigade[] = [
  {
    id: "br_yd",
    name: "Y&D",
    type: "internal",
    leadMasterId: "m-yura",
    helperMasterIds: ["m-danya-yd"],
    perJobCostCents: 0,
    isActive: true,
    createdAt: NOW,
  },
  {
    id: "br_dk",
    name: "D&K",
    type: "internal",
    leadMasterId: "m-danya-dk",
    helperMasterIds: ["m-kolya"],
    perJobCostCents: 0,
    isActive: true,
    createdAt: NOW,
  },
  {
    id: "br_george",
    name: "George Install",
    type: "outsource",
    leadMasterId: null,
    helperMasterIds: [],
    perJobCostCents: 0,
    isActive: true,
    createdAt: NOW,
  },
];

export const DEFAULT_BRIGADE_MEMBERS: BrigadeMember[] = [
  {
    id: "bm-yura",
    masterId: "m-yura",
    brigadeId: "br_yd",
    role: "lead",
    baseMonthlySalaryCents: BASE_SALARY_CENTS,
    percentRate: 10,
    joinedAt: NOW,
    leftAt: null,
  },
  {
    id: "bm-danya-yd",
    masterId: "m-danya-yd",
    brigadeId: "br_yd",
    role: "helper",
    baseMonthlySalaryCents: BASE_SALARY_CENTS,
    percentRate: 7,
    joinedAt: NOW,
    leftAt: null,
  },
  {
    id: "bm-danya-dk",
    masterId: "m-danya-dk",
    brigadeId: "br_dk",
    role: "lead",
    baseMonthlySalaryCents: BASE_SALARY_CENTS,
    percentRate: 10,
    joinedAt: NOW,
    leftAt: null,
  },
  {
    id: "bm-kolya",
    masterId: "m-kolya",
    brigadeId: "br_dk",
    role: "helper",
    baseMonthlySalaryCents: BASE_SALARY_CENTS,
    percentRate: 7,
    joinedAt: NOW,
    leftAt: null,
  },
];

// ─── Storage ───────────────────────────────────────────────────────────

const BRIGADES_KEY = "babun2:finance:brigades";
const MEMBERS_KEY = "babun2:finance:brigade_members";

export function loadBrigades(): Brigade[] {
  // STORY-072 leak fix — DEFAULT_BRIGADES contains AirFix-specific
  // brigade names (Y&D, D&K, George Install). New tenants start
  // empty; explicit demo seed lives under seedBrigades().
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(BRIGADES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveBrigades(list: Brigade[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BRIGADES_KEY, JSON.stringify(list));
  } catch {
    // ignore quota errors
  }
}

export function loadBrigadeMembers(): BrigadeMember[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MEMBERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveBrigadeMembers(list: BrigadeMember[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MEMBERS_KEY, JSON.stringify(list));
  } catch {
    // ignore quota errors
  }
}

// ─── CRUD ──────────────────────────────────────────────────────────────

export function getBrigade(id: string): Brigade | undefined {
  return loadBrigades().find((b) => b.id === id);
}

export function createBrigade(data: Omit<Brigade, "id" | "createdAt">): Brigade {
  const brigade: Brigade = {
    ...data,
    id: generateId("br"),
    createdAt: new Date().toISOString(),
  };
  const list = loadBrigades();
  list.push(brigade);
  saveBrigades(list);
  return brigade;
}

export function updateBrigade(id: string, patch: Partial<Omit<Brigade, "id" | "createdAt">>): Brigade | null {
  const list = loadBrigades();
  const idx = list.findIndex((b) => b.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...patch };
  saveBrigades(list);
  return list[idx];
}

export function createBrigadeMember(data: Omit<BrigadeMember, "id">): BrigadeMember {
  const member: BrigadeMember = { ...data, id: generateId("bm") };
  const list = loadBrigadeMembers();
  list.push(member);
  saveBrigadeMembers(list);
  return member;
}

// ─── Helpers ───────────────────────────────────────────────────────────

export function getActiveMembersForBrigade(brigadeId: string): BrigadeMember[] {
  return loadBrigadeMembers().filter(
    (m) => m.brigadeId === brigadeId && m.leftAt === null
  );
}

/** Return members active at a given ISO date. */
export function getMembersAtDate(brigadeId: string, dateIso: string): BrigadeMember[] {
  return loadBrigadeMembers().filter(
    (m) =>
      m.brigadeId === brigadeId &&
      m.joinedAt <= dateIso &&
      (m.leftAt === null || m.leftAt >= dateIso)
  );
}

/** Seed brigades and members if not yet stored. Idempotent — checks by id. */
export function seedBrigades(): void {
  if (typeof window === "undefined") return;
  const existing = loadBrigades();
  const existingIds = new Set(existing.map((b) => b.id));
  const toAdd = DEFAULT_BRIGADES.filter((b) => !existingIds.has(b.id));
  if (toAdd.length > 0) saveBrigades([...existing, ...toAdd]);

  const existingMembers = loadBrigadeMembers();
  const existingMemberIds = new Set(existingMembers.map((m) => m.id));
  const membersToAdd = DEFAULT_BRIGADE_MEMBERS.filter((m) => !existingMemberIds.has(m.id));
  if (membersToAdd.length > 0) saveBrigadeMembers([...existingMembers, ...membersToAdd]);
}
