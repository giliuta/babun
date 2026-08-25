// Waitlist — clients who couldn't get a slot and should be called back.
// Stored in localStorage for the prototype; migrates to Supabase with the
// rest of the data model.

import { generateId } from "@/lib/masters";

export type WaitlistStatus = "pending" | "contacted" | "booked" | "dropped";

export interface WaitlistItem {
  id: string;
  client_name: string;
  phone: string;
  services: string; // free text until we switch to structured service_ids
  master: string;
  deadline: string; // "до какого числа можно записать"
  time_pref: string; // "утро", "после 18:00"
  location: string;
  note: string;
  status: WaitlistStatus;
  created_at: string;
}

const STORAGE_KEY = "babun-waitlist";

export function loadWaitlist(): WaitlistItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as WaitlistItem[];
  } catch {
    return [];
  }
}

export function saveWaitlist(list: WaitlistItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}

export function createBlankWaitlistItem(): WaitlistItem {
  return {
    id: generateId("wl"),
    client_name: "",
    phone: "",
    services: "",
    master: "",
    deadline: "",
    time_pref: "",
    location: "",
    note: "",
    status: "pending",
    created_at: new Date().toISOString(),
  };
}

export const STATUS_LABELS: Record<WaitlistStatus, string> = {
  pending: "Ожидает",
  contacted: "Связались",
  booked: "Записан",
  dropped: "Не актуально",
};

export const STATUS_COLORS: Record<WaitlistStatus, string> = {
  pending: "text-[var(--system-orange)] bg-[rgba(255,149,0,0.08)]",
  contacted: "text-[var(--accent)] bg-[var(--accent-tint)]",
  booked: "text-[var(--system-green)] bg-[rgba(52,199,89,0.08)]",
  dropped: "text-[var(--label-secondary)] bg-[var(--fill-primary)]",
};
