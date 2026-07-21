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

/** Короткие подписи строк сортировки. «A/C» → «По технике» (внятно и в
 *  одно слово с фильтром «Тип техники» / метрикой acCount). */
export const SORT_LABELS: Record<SortKey, string> = {
  recent: "Недавние",
  name: "Имя",
  revenue: "Доход",
  equipment: "По технике",
};

/** Подсказка-направление справа в строке сортировки — снимает любую
 *  двусмысленность («что и куда сортируем»). */
export const SORT_HINTS: Record<SortKey, string> = {
  recent: "у кого недавно был визит",
  name: "по алфавиту, А–Я",
  revenue: "кто больше платит",
  equipment: "у кого больше техники",
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
  "today" | "7d" | "30d" | "90d" | "month" | "prevMonth" | "year" | "custom";

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
  /** Выбранные статусы — AND-семантика (как теги). Пусто = все. */
  segments: SegmentKey[];
  selectedTeams: string[];
  selectedCities: string[];
  activeTags: string[];
  period: PeriodValue | null;
}

export const EMPTY_FILTER: ClientsFilter = {
  sort: "recent",
  segments: [],
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
    f.segments.length
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
