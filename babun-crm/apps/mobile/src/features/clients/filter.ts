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

export type SortKey = "recent" | "name" | "revenue";

/** Подписи сортировки — строка в «Настройки клиентов» (сортировка живёт
 *  ТОЛЬКО там, из листа «Фильтры» удалена — решение владельца 2026-07-22;
 *  персист в sort-pref.ts). */
export const SORT_LABELS_LONG: Record<SortKey, string> = {
  recent: "Недавно посещали",
  name: "По имени (А–Я)",
  revenue: "По доходу",
};

export const SORT_ORDER: SortKey[] = ["recent", "name", "revenue"];

// ── Segments (Статус) ──────────────────────────────────────────────

export type Segment =
  | "all"
  | "debt"
  | "noUpcoming"
  | "reminderDue"
  | "silent"
  | "birthday"
  | "new"
  | "loyal"
  | "blacklist";

/** Конкретный статус (без служебного «all») — единица мультивыбора. */
export type SegmentKey = Exclude<Segment, "all">;

/** Порядок (деньги/действие вперёд) + RU-подписи. «Без записи» и
 *  «Напомнить» — «дела»: кого дозаписать и по кому сработало напоминание. */
export const SEGMENT_OPTIONS: { key: SegmentKey; label: string }[] = [
  { key: "debt", label: "Должники" },
  { key: "noUpcoming", label: "Без записи" },
  { key: "reminderDue", label: "Напомнить" },
  { key: "silent", label: "Давно не были" },
  { key: "birthday", label: "Дни рождения" },
  { key: "new", label: "Новые" },
  { key: "loyal", label: "Постоянные" },
  { key: "blacklist", label: "Чёрный список" },
];

function todayYMD(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Проходит ли клиент один конкретный статус — единый предикат для
 *  фильтра (AND по выбранным) и счётчиков-гейтов видимости. */
export function matchesSegment(
  c: Client,
  key: SegmentKey,
  s: ClientStats | undefined,
): boolean {
  switch (key) {
    case "debt":
      return (s?.debt ?? 0) > 0 || c.balance < 0;
    case "noUpcoming":
      // Был визит, но следующего нет — кого дозаписать (реактивация).
      return (s?.visits ?? 0) > 0 && (s?.nextApt ?? null) === null;
    case "reminderDue":
      // Напоминание, поставленное руками, уже сработало (сегодня/прошло).
      return !!c.reminder_at && c.reminder_at <= todayYMD();
    case "silent":
      return s ? isLongSilence(s) : false;
    case "birthday": {
      const dd = s?.birthdayInDays ?? null;
      return dd !== null && dd <= 14;
    }
    case "new":
      return s ? isNewClient(s) : false;
    case "loyal":
      return s ? isLoyalClient(s) : false;
    case "blacklist":
      return c.blacklisted;
  }
}

export interface SegmentCounts {
  debt: number;
  noUpcoming: number;
  reminderDue: number;
  silent: number;
  birthday: number;
  new: number;
  loyal: number;
  blacklist: number;
}

/** Счётчики авто-сегментов — теперь только гейт видимости чипов. */
export function buildSegmentCounts(
  clients: Client[],
  statsMap: Map<string, ClientStats>,
): SegmentCounts {
  const counts: SegmentCounts = {
    debt: 0,
    noUpcoming: 0,
    reminderDue: 0,
    silent: 0,
    birthday: 0,
    new: 0,
    loyal: 0,
    blacklist: 0,
  };
  for (const c of clients) {
    const s = statsMap.get(c.id);
    for (const opt of SEGMENT_OPTIONS) {
      if (matchesSegment(c, opt.key, s)) counts[opt.key] += 1;
    }
  }
  return counts;
}

// ── Period ─────────────────────────────────────────────────────────

export type PeriodPreset =
  | "today"
  | "yesterday"
  | "week"
  | "lastweek"
  | "month"
  | "lastmonth"
  | "year"
  | "lastyear"
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

/** Пресеты от РЕАЛЬНОЙ текущей даты — набор Финансов ОДИН В ОДИН
 *  (решение владельца 2026-07-22, зеркало finances/period.ts): пары
 *  «текущий/прошлый», в 2-кол сетке каждый ряд = пара. */
export function buildPeriodPresets(): PeriodPresetDef[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const y = today.getFullYear();
  const m = today.getMonth();
  const shift = (d: Date, n: number) => {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  };
  // Monday-based ISO week, как календарная сетка.
  const dow = (today.getDay() + 6) % 7;
  const monday = shift(today, -dow);
  const prevMonday = shift(today, -dow - 7);
  const yesterday = shift(today, -1);
  return [
    { key: "today", label: "Сегодня", from: ymd(today), to: ymd(today) },
    {
      key: "yesterday",
      label: "Вчера",
      from: ymd(yesterday),
      to: ymd(yesterday),
    },
    {
      key: "week",
      label: "Текущая неделя",
      from: ymd(monday),
      to: ymd(shift(monday, 6)),
    },
    {
      key: "lastweek",
      label: "Прошлая неделя",
      from: ymd(prevMonday),
      to: ymd(shift(prevMonday, 6)),
    },
    {
      key: "month",
      label: "Текущий месяц",
      from: ymd(new Date(y, m, 1)),
      to: ymd(new Date(y, m + 1, 0)),
    },
    {
      key: "lastmonth",
      label: "Прошлый месяц",
      from: ymd(new Date(y, m - 1, 1)),
      to: ymd(new Date(y, m, 0)),
    },
    {
      key: "year",
      label: "Текущий год",
      from: ymd(new Date(y, 0, 1)),
      to: ymd(new Date(y, 11, 31)),
    },
    {
      key: "lastyear",
      label: "Прошлый год",
      from: ymd(new Date(y - 1, 0, 1)),
      to: ymd(new Date(y - 1, 11, 31)),
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
  yesterday: "Вчера",
  week: "Текущая неделя",
  lastweek: "Прошлая неделя",
  month: "Текущий месяц",
  lastmonth: "Прошлый месяц",
  year: "Текущий год",
  lastyear: "Прошлый год",
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
  /** Выбранные статусы — OR-семантика («список на обзвон»: любой из
   *  выбранных), как у всех фасетов листа. Пусто = все. */
  segments: SegmentKey[];
  selectedTeams: string[];
  selectedCities: string[];
  activeTags: string[];
  period: PeriodValue | null;
}

export const EMPTY_FILTER: ClientsFilter = {
  segments: [],
  selectedTeams: [],
  selectedCities: [],
  activeTags: [],
  period: null,
};

/** Сколько активных ЗНАЧЕНИЙ фильтра. */
export function filterActiveCount(f: ClientsFilter): number {
  return (
    f.selectedTeams.length +
    f.selectedCities.length +
    f.activeTags.length +
    (f.period ? 1 : 0) +
    f.segments.length
  );
}

/** Сброс всех фильтров (сортировка — отдельная настройка, sort-pref.ts). */
export function resetFilters(): ClientsFilter {
  return { ...EMPTY_FILTER };
}
