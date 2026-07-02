import type { Client } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";

// Mobile port of the web ClientsFilterPanel facets (Статус / Тег / Город).
// Команда/Период are deferred (need appointments+teams join / a date wheel).
export type ClientStatus = "all" | "active" | "debtors" | "blacklisted";

export interface ClientsFilter {
  status: ClientStatus;
  tagIds: string[];
  cities: string[];
}

export const EMPTY_FILTER: ClientsFilter = {
  status: "all",
  tagIds: [],
  cities: [],
};

export const STATUS_OPTIONS: { key: ClientStatus; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "active", label: "Активные" },
  { key: "debtors", label: "Должники" },
  { key: "blacklisted", label: "Чёрный список" },
];

export function filterActiveCount(f: ClientsFilter): number {
  return (f.status !== "all" ? 1 : 0) + f.tagIds.length + f.cities.length;
}

export function applyClientsFilter(
  clients: Client[],
  f: ClientsFilter,
  statsMap?: Map<string, ClientStats>,
): Client[] {
  return clients.filter((c) => {
    if (f.status === "active" && c.blacklisted) return false;
    // Должник = долг по завершённым визитам ИЛИ минусовой баланс — web
    // parity (useClientFilters «debt»). В живых данных balance почти
    // всегда 0; реальный долг живёт в payment_status визитов (stats).
    if (f.status === "debtors") {
      const debt = statsMap?.get(c.id)?.debt ?? 0;
      if (!(debt > 0 || c.balance < 0)) return false;
    }
    if (f.status === "blacklisted" && !c.blacklisted) return false;
    // AND-семантика как в вебе: каждый выбранный тег обязателен.
    if (f.tagIds.length && !f.tagIds.every((t) => c.tag_ids.includes(t)))
      return false;
    if (f.cities.length && !f.cities.includes(c.city)) return false;
    return true;
  });
}

// Distinct non-empty cities across the tenant's clients (facet options).
export function cityOptions(clients: Client[]): string[] {
  const set = new Set<string>();
  for (const c of clients) if (c.city) set.add(c.city);
  return [...set].sort((a, b) => a.localeCompare(b, "ru"));
}
