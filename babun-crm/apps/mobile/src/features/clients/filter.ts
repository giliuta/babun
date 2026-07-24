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

/** Рабочие статусы-«дела» диспетчера — в чип-ленте и лотке стоят на
 *  постоянных местах всегда (мышечная память). */
export const CORE_SEGMENTS = new Set<SegmentKey>([
  "debt",
  "noUpcoming",
  "reminderDue",
]);

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

/** Период всегда задаётся явным диапазоном (лента месяцев / колёса). */
export type PeriodPreset = "custom";

/** Активный период. null везде = «Всё время» (нет фильтра).
 *  from/to — включительные YYYY-MM-DD. Пресетов больше нет: период
 *  задаёт лента месяцев или колёса С–До — всегда явный диапазон. */
export interface PeriodValue {
  preset: PeriodPreset;
  from: string;
  to: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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

/** Именительный падеж — подписи целых месяцев («Июнь», «Март — Май»). */
const M_NOM = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

/** Подписи колонок ленты («Май», не «мая» и не капс — воздух и покой). */
export const M_BAND = [
  "Янв",
  "Фев",
  "Мар",
  "Апр",
  "Май",
  "Июн",
  "Июл",
  "Авг",
  "Сен",
  "Окт",
  "Ноя",
  "Дек",
];

function fmtShort(key: string): string {
  const [, mo, d] = key.split("-").map(Number);
  if (!mo || !d) return key;
  return `${d} ${M_GEN[mo - 1]}`;
}

/** Подпись периода — умная: целые месяцы называются по имени
 *  («Июнь», «Март — Май», «Ноябрь ’25»), произвольные даты — числами
 *  («1 июн–15 июн»). Используется токеном бара и значением в листе. */
export function periodLabel(period: PeriodValue): string {
  const [fy, fm, fd] = period.from.split("-").map(Number);
  const [ty, tm, td] = period.to.split("-").map(Number);
  if (!fy || !ty) return "Период";
  const curYear = new Date().getFullYear();
  const lastDay = new Date(ty, tm, 0).getDate();
  const monthAligned = fd === 1 && td === lastDay;
  if (monthAligned) {
    const fLbl = `${M_NOM[fm - 1]}${fy !== curYear ? ` ’${String(fy).slice(2)}` : ""}`;
    if (fy === ty && fm === tm) return fLbl;
    const tLbl = `${M_NOM[tm - 1]}${ty !== curYear ? ` ’${String(ty).slice(2)}` : ""}`;
    return `${fLbl} — ${tLbl}`;
  }
  return `${fmtShort(period.from)}–${fmtShort(period.to)}`;
}

// ── Лента месяцев ──────────────────────────────────────────────────

export interface PeriodMonth {
  /** YYYY-MM. */
  key: string;
  /** Подпись колонки («Май»). */
  label: string;
  /** Год месяца — лента рисует границы и подписи годов сама. */
  year: number;
  /** Январь — граница года (разделитель на треке). */
  isJanuary: boolean;
  /** Первый/последний день месяца (включительно, YYYY-MM-DD). */
  from: string;
  to: string;
}

/** Окно последних 24 месяцев (старые → новые) — лента листается пальцем
 *  в прошлое. Чистые названия месяцев, без гравюры (решение владельца
 *  2026-07-24: «без мишуры»). */
export function buildPeriodMonths(): PeriodMonth[] {
  const now = new Date();
  const out: PeriodMonth[] = [];
  for (let i = 23; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth();
    out.push({
      key: `${y}-${pad(m + 1)}`,
      label: M_BAND[m],
      year: y,
      isJanuary: m === 0,
      from: ymd(new Date(y, m, 1)),
      to: ymd(new Date(y, m + 1, 0)),
    });
  }
  return out;
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
