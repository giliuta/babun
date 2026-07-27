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

export type SortKey =
  | "recent"
  | "stale"
  | "debt"
  | "revenue"
  | "expected"
  | "name";

/** ЗАКОН СОРТИРОВКИ (владелец + арбитраж 2026-07-25): сортируем только по
 *  тому числу, которое НАПЕЧАТАНО в карточке списка, а подпись описывает
 *  ПЕРВУЮ карточку («Недавний визит» — сверху свежий). Направление вшито
 *  в ключ: отдельной сущности «по возр./по убыв.» нет, двусторонней
 *  сделана одна ось «визит» — обе её стороны рабочие («Давний визит» +
 *  «Без записи» = список на дозвон). Сортировка — первая строка листа
 *  «Фильтры», персистентна (sort-pref.ts), «Сбросить» её не трогает. */
export const SORT_LABELS_LONG: Record<SortKey, string> = {
  recent: "Недавний визит",
  stale: "Давний визит",
  // Короткие имена осей (владелец 2026-07-25: «просто долг, доход» —
  // «самый большой» было многословно). Больше — всегда сверху: обратной
  // стороны у денег не бывает, поэтому направление в подписи не нужно.
  debt: "Долг",
  revenue: "Доход",
  // Третье число карточки наконец стало осью: «Период: следующая неделя»
  // + эта ось = самые дорогие предстоящие работы сверху. Подпись НЕ
  // обещает «за период» — expectedRevenue суммирует все будущие записи.
  expected: "Ожидается",
  name: "Имя (А–Я)",
};

export const SORT_ORDER: SortKey[] = [
  "recent",
  "stale",
  "debt",
  "revenue",
  "expected",
  "name",
];

/** Смысловые группы рядов попапа (волосок между блоками): время · деньги
 *  · алфавит. */
export const SORT_BLOCKS: SortKey[][] = [
  ["recent", "stale"],
  ["debt", "revenue", "expected"],
  ["name"],
];

/** Долг клиента РОВНО как он напечатан в карточке списка (долг по визитам,
 *  иначе отрицательный баланс). Один источник для карточки, сортировки и
 *  статуса «Должники». */
export function clientDebt(c: Client, s: ClientStats | undefined): number {
  const byVisits = s?.debt ?? 0;
  // Округляем ЗДЕСЬ: копейки от округления сумм давали «долг €0» в
  // карточке и ложное попадание в статус «Должники».
  if (byVisits > 0) return Math.round(byVisits);
  return c.balance < 0 ? Math.round(Math.abs(c.balance)) : 0;
}

/** Сортировка списка клиентов. Ключи предвычисляются ОДНИМ проходом,
 *  дальше сравниваются числа/строки — statsMap не дёргается на каждое
 *  сравнение (2000 карточек ≈ 22 тыс. сравнений).
 *
 *  ПРАВИЛО ХВОСТА: у кого нет значения по активной оси (ни одного визита /
 *  нет долга / нет дохода) — вниз при ЛЮБОМ направлении. Фолбэка
 *  «lastVisitDate || created_at» нет: он ставил клиента «нет записей» выше
 *  обслуженного сегодня (ISO-время created_at длиннее и «больше» голой
 *  даты) и печатал «Недавний визит» над карточкой без визитов.
 *
 *  Тай-брейкеры: закреплённые → есть значение → значение → свежесть
 *  визита → добавлен → имя → закреплён когда → id (детерминизм: список
 *  пересобирается после каждого синка, «дрожь» порядка была бы видна). */
export function sortClients(
  clients: Client[],
  statsMap: Map<string, ClientStats>,
  sort: SortKey,
): Client[] {
  const collator = new Intl.Collator("ru");
  const rows = clients.map((c) => {
    const s = statsMap.get(c.id);
    const last = s?.lastVisitDate ?? "";
    let has = 1; // есть ли значение по активной оси
    let num = 0; // числовая ось (деньги)
    let str = ""; // строковая ось (даты)
    if (sort === "recent" || sort === "stale") {
      has = last ? 1 : 0;
      str = last;
    } else if (sort === "debt") {
      num = clientDebt(c, s);
      has = num > 0 ? 1 : 0;
    } else if (sort === "revenue") {
      num = s?.totalSpent ?? 0;
      has = num > 0 ? 1 : 0;
    } else if (sort === "expected") {
      num = s?.expectedRevenue ?? 0;
      has = num > 0 ? 1 : 0;
    } else {
      // Имя — тоже ось: безымянный клиент не имеет значения и уходит в
      // хвост, а не встаёт первым в «Имя (А–Я)».
      has = c.full_name.trim() ? 1 : 0;
    }
    return { c, pinned: c.pinned_at ? 1 : 0, pinnedAt: c.pinned_at ?? "", has, num, str, last };
  });
  // ISO-даты и uuid сравниваем строками напрямую — коллатор нужен только
  // именам (он на порядок дороже и на датах бессмыслен).
  rows.sort((a, b) => {
    if (a.pinned !== b.pinned) return b.pinned - a.pinned;
    if (a.has !== b.has) return b.has - a.has;
    if (a.has) {
      if (sort === "recent") {
        if (a.str !== b.str) return a.str < b.str ? 1 : -1;
      } else if (sort === "stale") {
        if (a.str !== b.str) return a.str < b.str ? -1 : 1;
      } else if (
        sort === "debt" ||
        sort === "revenue" ||
        sort === "expected"
      ) {
        if (a.num !== b.num) return b.num - a.num;
      } else {
        const n = collator.compare(a.c.full_name, b.c.full_name);
        if (n !== 0) return n;
      }
    }
    if (sort !== "recent" && sort !== "stale" && a.last !== b.last)
      return a.last < b.last ? 1 : -1;
    if (a.c.created_at !== b.c.created_at)
      return a.c.created_at < b.c.created_at ? 1 : -1;
    const byName = collator.compare(a.c.full_name, b.c.full_name);
    if (byName !== 0) return byName;
    if (a.pinnedAt !== b.pinnedAt) return a.pinnedAt < b.pinnedAt ? 1 : -1;
    return a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0;
  });
  return rows.map((r) => r.c);
}

// ── Segments (Статус) ──────────────────────────────────────────────

export type Segment =
  | "all"
  | "debt"
  | "debtNoUpcoming"
  | "noUpcoming"
  | "reminderDue"
  | "silent"
  | "neverCame"
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
  ["debt", "debtNoUpcoming", "noUpcoming", "reminderDue"],
  ["silent", "neverCame", "birthday", "new", "loyal", "blacklist"],
];

/** Порядок (деньги/действие вперёд) + RU-подписи. ЗАКОН ПОДПИСИ
 *  (владелец 2026-07-25, «в статусах путаница»): подпись обязана
 *  описывать РОВНО тот предикат, что стоит рядом в matchesSegment, —
 *  иначе фильтр врёт. Отсюда правки: «Без записи» → «Пора дозаписать»
 *  (клиент БЫЛ у нас, но следующего визита нет; новичок без единой
 *  записи сюда не попадает — он в «Недавно добавлены»), «Напомнить» →
 *  «Пора напомнить» (напоминание уже сработало, а не «поставить»),
 *  «Дни рождения» → «Скоро день рождения» (окно 14 дней), «Новые» →
 *  «Недавно добавлены» (заведён < 30 дней назад, а не «был один раз»). */
export const SEGMENT_OPTIONS: { key: SegmentKey; label: string }[] = [
  { key: "debt", label: "Должники" },
  // «Долг, не записан» — пересечь «Должники» × «Пора дозаписать» нельзя:
  // внутри фасета семантика ИЛИ. Отдельный ряд закрывает главный
  // денежный список: должен и больше не придёт.
  { key: "debtNoUpcoming", label: "Долг, не записан" },
  { key: "noUpcoming", label: "Пора дозаписать" },
  { key: "reminderDue", label: "Пора напомнить" },
  { key: "silent", label: "Давно не были" },
  // Дыра, которую не закрывало НИ ОДНО сочетание фильтров: заведён
  // давно, ни одного визита и не записан — оплаченный рекламой лид,
  // невидимый в CRM («Пора дозаписать» требует visits>0, «Недавно
  // добавлены» — моложе 30 дней).
  { key: "neverCame", label: "Так и не приехали" },
  { key: "birthday", label: "Скоро день рождения" },
  { key: "new", label: "Недавно добавлены" },
  { key: "loyal", label: "Постоянные" },
  { key: "blacklist", label: "Чёрный список" },
];

export function todayYMD(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Пороги статусов — в одном месте: их называют подписи и подзаголовки,
 *  и владелец однажды захочет их настраивать. */
export const SILENCE_DAYS = 60; // «Давно не были»
export const NEW_DAYS = 30; // «Недавно добавлены»
export const LOYAL_VISITS = 5; // «Постоянные»
export const BIRTHDAY_DAYS = 14; // «Скоро день рождения»

/** Проходит ли клиент один конкретный статус — единый предикат для
 *  фильтра (AND по выбранным) и счётчиков-гейтов видимости.
 *  `today` передаётся снаружи: это горячий цикл (N клиентов × 8 статусов),
 *  и «сегодня» не должно плыть по ходу одного прохода. */
export function matchesSegment(
  c: Client,
  key: SegmentKey,
  s: ClientStats | undefined,
  today: string = todayYMD(),
): boolean {
  switch (key) {
    case "debt":
      // Тот же долг, что печатается в карточке и сортирует ось «Долг» —
      // одна формула на все три места.
      return clientDebt(c, s) > 0;
    case "debtNoUpcoming":
      // «Долг, не записан»: должен и не придёт — деньги уходят.
      return clientDebt(c, s) > 0 && (s?.nextApt ?? null) === null;
    case "noUpcoming":
      // «Пора дозаписать»: был визит, но следующего нет (реактивация).
      return (s?.visits ?? 0) > 0 && (s?.nextApt ?? null) === null;
    case "neverCame":
      // «Так и не приехали»: заведён давно, визитов нет, не записан.
      return (
        (s?.visits ?? 0) === 0 &&
        (s?.nextApt ?? null) === null &&
        (s?.ageDays ?? 0) >= NEW_DAYS
      );
    case "reminderDue":
      // Напоминание, поставленное руками, уже сработало (сегодня/прошло).
      // reminder_at приходит из БД как timestamptz («2026-07-24T…») после
      // синка — режем до YYYY-MM-DD, иначе строковое сравнение с датой
      // выкидывает СЕГОДНЯШНИЕ напоминания (T > пусто).
      return !!c.reminder_at && c.reminder_at.slice(0, 10) <= today;
    case "silent":
      return s ? isLongSilence(s, SILENCE_DAYS) : false;
    case "birthday": {
      const dd = s?.birthdayInDays ?? null;
      return dd !== null && dd <= BIRTHDAY_DAYS;
    }
    case "new":
      return s ? isNewClient(s, NEW_DAYS) : false;
    case "loyal":
      return s ? isLoyalClient(s, LOYAL_VISITS) : false;
    case "blacklist":
      return c.blacklisted;
  }
}

/** Подзаголовок попапа фасета — ОДНА строка, описывающая ровно предикат
 *  (закон подписи). Там, где семантика неочевидна, говорим прямо: по
 *  визитам, а не по карточке. */
export const FACET_SUBTITLES: Record<string, string> = {
  segment: "Любой из выбранных",
  city: "Любая из выбранных меток",
  tag: "Любой из выбранных тегов",
  team: "Кто когда-либо обслуживал — по визитам",
  source: "Любой из выбранных источников",
  property: "По карточке и объектам клиента",
  sort: "Что окажется сверху списка",
};

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

// LEGACY-ПЕРЕЧИСЛЕНИЕ ТИПОВ ОБЪЕКТА — только словарь ПЕРЕВОДА.
//
// Живой словарь принадлежит бизнесу: строка выбора на объекте пишет в
// `loc.label` его собственные слова («Дом», «Склад», «Бокс»), и фасет фильтра
// собирается из фактических значений (useClientFilters.propertyOptions).
// Здесь остались шесть значений старого enum'а — их надо уметь ПОКАЗАТЬ
// человеку у клиентов, заведённых до перехода, и не более того. Предлагать их
// как варианты выбора нельзя: у нового бизнеса таких значений в данных нет, и
// фильтр честно отдавал пустой список (аудит 2026-07-27).
const PROPERTY_ORDER: PropertyType[] = [
  "apartment",
  "house",
  "office",
  "restaurant",
  "shop",
  "other",
];

const PROPERTY_OPTIONS = PROPERTY_ORDER.map((key) => ({
  value: key as string,
  label: PROPERTY_LABELS[key],
  color: "",
}));

/** Источник клиента: пустые legacy-строки читаются как «Неизвестно». */
export function clientSource(c: Client): AcquisitionSource {
  return (c.acquisition_source || "unknown") as AcquisitionSource;
}

/** Типы объектов клиента. Владелец 2026-07-26: «метка — это и есть тип
 *  объекта: дом, офис, вилла — стандарт, и можно добавить своё». Значит
 *  словарь принадлежит БИЗНЕСУ (пресеты кабинета «Типы объектов»), а не
 *  зашитому перечислению — для SaaS это единственно верно: у автомойки свои
 *  типы, у кондиционерщиков свои.
 *
 *  Поэтому фасет собирает и метки объектов, и legacy-перечисление (у старых
 *  клиентов оно заполнено, и терять его нельзя). */
export function clientPropertyTypes(c: Client): Set<string> {
  const out = new Set<string>();
  if (c.property_type) out.add(c.property_type);
  for (const loc of c.locations ?? []) {
    if (loc.property_type) out.add(loc.property_type);
    const label = loc.label?.trim();
    if (label) out.add(label);
  }
  return out;
}

/** Человеческая подпись значения фасета: legacy-перечисление переводим, а
 *  метку бизнеса печатаем как есть — она уже на его языке. */
export function propertyTypeLabel(value: string): string {
  return PROPERTY_OPTIONS.find((o) => o.value === value)?.label ?? value;
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
