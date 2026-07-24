import {
  ACQUISITION_LABELS,
  PROPERTY_LABELS,
  type AcquisitionSource,
  type Client,
  type PropertyType,
} from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import {
  isLongSilence,
  isLoyalClient,
  isNewClient,
} from "@babun/shared/local/selectors/client-stats";
import { PERIOD_LABELS, type Period } from "@/features/finances/period";

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

/** Блоки попапа «Статус» (грамматика попапа периода — деление без
 *  подписей): «дела» диспетчера на постоянных местах · «портрет» клиента.
 *  Все ряды видны всегда; при нуле — пригашены. */
export const SEGMENT_BLOCKS: SegmentKey[][] = [
  ["debt", "noUpcoming", "reminderDue"],
  ["silent", "birthday", "new", "loyal", "blacklist"],
];

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

// Счётчики сегментов живут контекстно в useClientFilters.facetCounts
// (веб-парити): считаются с учётом ВСЕХ остальных фасетов + периода.

// ── Источник · Язык · Тип объекта (владелец 2026-07-24) ────────────

/** Канонический порядок источников — порядок попапа и сводки строки. */
export const SOURCE_ORDER: AcquisitionSource[] = [
  "referral",
  "instagram",
  "whatsapp",
  "google_maps",
  "website",
  "repeat",
  "walk_in",
  "other",
  "unknown",
];

export const SOURCE_OPTIONS = SOURCE_ORDER.map((key) => ({
  value: key as string,
  label: ACQUISITION_LABELS[key],
  color: "",
}));

/** Канонический порядок типов объектов. */
export const PROPERTY_ORDER: PropertyType[] = [
  "apartment",
  "house",
  "office",
  "restaurant",
  "shop",
  "other",
];

export const PROPERTY_OPTIONS = PROPERTY_ORDER.map((key) => ({
  value: key as string,
  label: PROPERTY_LABELS[key],
  color: "",
}));

/** Источник клиента: пустые legacy-строки читаются как «Неизвестно». */
export function clientSource(c: Client): AcquisitionSource {
  return (c.acquisition_source || "unknown") as AcquisitionSource;
}

/** Типы объектов клиента: legacy-поле карточки + все объекты. */
export function clientPropertyTypes(c: Client): Set<string> {
  const out = new Set<string>();
  if (c.property_type) out.add(c.property_type);
  for (const loc of c.locations ?? []) {
    if (loc.property_type) out.add(loc.property_type);
  }
  return out;
}

// ── Period ─────────────────────────────────────────────────────────

/** Период — общий диалект приложения (решение владельца 2026-07-24:
 *  «точно так же, как в Финансах»): пресеты парами текущий/прошлый из
 *  finances/period + «Свой период» с колёс С–До. null везде = «Всё
 *  время» (нет фильтра) — состояние, которого у Финансов не бывает. */
export type PeriodValue = Period;

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

function fmtShort(key: string): string {
  const [, mo, d] = key.split("-").map(Number);
  if (!mo || !d) return key;
  return `${d} ${M_GEN[mo - 1]}`;
}

/** Подпись периода: пресет называется по имени («Текущий месяц»), свой
 *  диапазон — умно: целые месяцы по имени («Июнь», «Март — Май»,
 *  «Ноябрь ’25»), произвольные даты — числами («1 июн–15 июн»).
 *  Используется токеном бара и сводкой в шапке листа. */
export function periodLabel(period: PeriodValue): string {
  if (period.preset !== "custom") return PERIOD_LABELS[period.preset];
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

// ── Facets / tokens ────────────────────────────────────────────────

export type FacetKey = "team" | "city" | "tag";

/** Значение внутри фасет-попапа (Команда / Метка / Тег). */
export interface FacetOption {
  value: string;
  label: string;
  /** Цвет тика сущности (hex/rgba). */
  color: string;
  /** Метка вне библиотеки (свободный legacy-город) — отдельный блок. */
  legacy?: boolean;
}

/** Удаляемый токен в summary-баре. */
export interface ActiveToken {
  key: FacetKey | "period" | "segment" | "source" | "property";
  val: string;
  label: string;
  /** Пустая строка → без точки (период/сегмент/источник/тип). */
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
  sources: AcquisitionSource[];
  propertyTypes: PropertyType[];
}

export const EMPTY_FILTER: ClientsFilter = {
  segments: [],
  selectedTeams: [],
  selectedCities: [],
  activeTags: [],
  period: null,
  sources: [],
  propertyTypes: [],
};

/** Сколько активных ЗНАЧЕНИЙ фильтра. */
export function filterActiveCount(f: ClientsFilter): number {
  return (
    f.selectedTeams.length +
    f.selectedCities.length +
    f.activeTags.length +
    (f.period ? 1 : 0) +
    f.segments.length +
    f.sources.length +
    f.propertyTypes.length
  );
}

/** Сброс всех фильтров (сортировка — отдельная настройка, sort-pref.ts). */
export function resetFilters(): ClientsFilter {
  return { ...EMPTY_FILTER };
}
