import type { Client } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import {
  isLongSilence,
  isLoyalClient,
  isNewClient,
} from "@babun/shared/local/selectors/client-stats";

// Волна 2 — web-parity типы/константы фильтров клиентов. Порт
// apps/web/.../clients/filters/{types.ts,useClientFilters.ts} (v812).
// Чистый модуль без React — хук живёт в useClientFilters.ts.

// ── Sort ───────────────────────────────────────────────────────────

export type SortKey = "recent" | "name" | "revenue" | "equipment";

/** Короткие подписи pills в панели (web SortPills). */
export const SORT_LABELS: Record<SortKey, string> = {
  recent: "Недавние",
  name: "Имя",
  revenue: "Доход",
  equipment: "A/C",
};

/** Длинные подписи для строки «Сортировка списка» в настройках (web
 *  SORT_LABELS_RU из page.tsx v811). */
export const SORT_LABELS_LONG: Record<SortKey, string> = {
  recent: "Недавно посещали",
  name: "По имени (А–Я)",
  revenue: "По доходу",
  equipment: "По технике",
};

export const SORT_ORDER: SortKey[] = ["recent", "name", "revenue", "equipment"];

// ── Segments (Статус) ──────────────────────────────────────────────

export type Segment =
  | "all"
  | "debt"
  | "birthday"
  | "blacklist"
  | "silent"
  | "new"
  | "loyal";

/** Канонический порядок + RU-подписи — точно как web SEGMENT_OPTIONS. */
export const SEGMENT_OPTIONS: { key: Exclude<Segment, "all">; label: string }[] =
  [
    { key: "debt", label: "Должники" },
    { key: "birthday", label: "Дни рождения" },
    { key: "blacklist", label: "Чёрный список" },
    { key: "silent", label: "Давно не были" },
    { key: "new", label: "Новые" },
    { key: "loyal", label: "Постоянные" },
  ];

export interface SegmentCounts {
  debt: number;
  birthday: number;
  blacklist: number;
  silent: number;
  new: number;
  loyal: number;
}

/** Счётчики авто-сегментов (web page.tsx segmentCounts, без hero-полей). */
export function buildSegmentCounts(
  clients: Client[],
  statsMap: Map<string, ClientStats>,
): SegmentCounts {
  const counts: SegmentCounts = {
    debt: 0,
    birthday: 0,
    blacklist: 0,
    silent: 0,
    new: 0,
    loyal: 0,
  };
  for (const c of clients) {
    const s = statsMap.get(c.id);
    if ((s?.debt ?? 0) > 0 || c.balance < 0) counts.debt += 1;
    const dd = s?.birthdayInDays ?? null;
    if (dd !== null && dd <= 14) counts.birthday += 1;
    if (c.blacklisted) counts.blacklist += 1;
    if (s && isLongSilence(s)) counts.silent += 1;
    if (s && isNewClient(s)) counts.new += 1;
    if (s && isLoyalClient(s)) counts.loyal += 1;
  }
  return counts;
}

// ── Period ─────────────────────────────────────────────────────────

export type PeriodPreset =
  | "today"
  | "7d"
  | "30d"
  | "90d"
  | "month"
  | "prevMonth"
  | "year"
  | "custom";

/** Активный период. null везде = «Всё время» (нет фильтра).
 *  from/to — включительные YYYY-MM-DD. */
export interface PeriodValue {
  preset: PeriodPreset;
  from: string;
  to: string;
}

export interface PeriodPresetDef {
  key: Exclude<PeriodPreset, "custom">;
  label: string;
  from: string;
  to: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return ymd(d);
}

/** Пресеты от РЕАЛЬНОЙ текущей даты (web PeriodSection.buildPresets). */
export function buildPeriodPresets(): PeriodPresetDef[] {
  const now = new Date();
  const today = ymd(now);
  const y = now.getFullYear();
  const m = now.getMonth();
  return [
    { key: "today", label: "Сегодня", from: today, to: today },
    { key: "7d", label: "7 дней", from: daysAgo(6), to: today },
    { key: "30d", label: "30 дней", from: daysAgo(29), to: today },
    { key: "90d", label: "90 дней", from: daysAgo(89), to: today },
    {
      key: "month",
      label: "Этот месяц",
      from: ymd(new Date(y, m, 1)),
      to: ymd(new Date(y, m + 1, 0)),
    },
    {
      key: "prevMonth",
      label: "Прошлый месяц",
      from: ymd(new Date(y, m - 1, 1)),
      to: ymd(new Date(y, m, 0)),
    },
    {
      key: "year",
      label: "Этот год",
      from: ymd(new Date(y, 0, 1)),
      to: ymd(new Date(y, 11, 31)),
    },
  ];
}

const M_GEN = [
  "янв",
  "фев",
  "мар",
  "апр",
  "мая",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
];

const PRESET_LABELS: Record<string, string> = {
  today: "Сегодня",
  "7d": "7 дней",
  "30d": "30 дней",
  "90d": "90 дней",
  month: "Этот месяц",
  prevMonth: "Прошлый месяц",
  year: "Этот год",
};

function fmtShort(key: string): string {
  const [, mo, d] = key.split("-").map(Number);
  if (!mo || !d) return key;
  return `${d} ${M_GEN[mo - 1]}`;
}

/** Короткая подпись периода для токена бара (web periodLabel). */
export function periodLabel(period: PeriodValue): string {
  if (period.preset === "custom") {
    return `${fmtShort(period.from)}–${fmtShort(period.to)}`;
  }
  return PRESET_LABELS[period.preset] ?? "Период";
}

// ── Facets / tokens ────────────────────────────────────────────────

export type FacetKey = "team" | "city" | "tag";

/** Значение внутри фасет-секции (Команда / Метка / Тег). */
export interface FacetOption {
  value: string;
  label: string;
  /** Цвет ведущей точки (hex/rgba). */
  color: string;
}

/** Удаляемый токен в summary-баре. */
export interface ActiveToken {
  key: FacetKey | "period" | "segment";
  val: string;
  label: string;
  /** Пустая строка → без точки (период/сегмент). */
  color: string;
}

// ── Filter state ───────────────────────────────────────────────────

export interface ClientsFilter {
  sort: SortKey;
  segment: Segment;
  selectedTeams: string[];
  selectedCities: string[];
  activeTags: string[];
  period: PeriodValue | null;
}

export const EMPTY_FILTER: ClientsFilter = {
  sort: "recent",
  segment: "all",
  selectedTeams: [],
  selectedCities: [],
  activeTags: [],
  period: null,
};

/** Сколько активных ЗНАЧЕНИЙ фильтра (сортировка — не фильтр). */
export function filterActiveCount(f: ClientsFilter): number {
  return (
    f.selectedTeams.length +
    f.selectedCities.length +
    f.activeTags.length +
    (f.period ? 1 : 0) +
    (f.segment !== "all" ? 1 : 0)
  );
}

/** Сброс всех фильтров, сортировка сохраняется (web resetFilters). */
export function resetFilters(f: ClientsFilter): ClientsFilter {
  return { ...EMPTY_FILTER, sort: f.sort };
}

/** Кол-во кондиционеров: по локациям + legacy client.equipment
 *  (web acCount). */
export function acCount(c: Client): number {
  return (
    (c.locations ?? []).reduce(
      (sum, loc) => sum + (loc.equipment ?? []).length,
      0,
    ) + c.equipment.length
  );
}
