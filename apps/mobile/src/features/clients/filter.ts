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
} from "@babun/shared/local/selectors/client-stats";
import { countWordRu } from "@babun/shared/common/utils/pluralize";
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

/** ДОЛГ КЛИЕНТА — ОДНА ФОРМУЛА НА ВЕСЬ ПРОДУКТ: недоплата по ЗАВЕРШЁННЫМ
 *  визитам. Работа сделана, деньги не получены — больше долгу взяться неоткуда.
 *
 *  Ветка `balance < 0` убрана (владелец 2026-08-07: «как может образоваться
 *  долг и не быть записи? он не был записан, услуг не оказано»). Колонка
 *  `clients.balance` в продукте МЁРТВАЯ: её не считает ни один экран и ни
 *  один триггер базы, попасть туда число может только импортом или правкой
 *  в БД. Но печаталась она как долг — и была единственным способом показать
 *  задолженность человеку, которому не сделали ни одной работы.
 *
 *  Хуже: ветки соединялись через `else`, а не складывались. У клиента с
 *  долгом €50 по визиту и легаси-балансом −€200 показывалось €50; диспетчер
 *  принимал деньги — и на экране появлялось €200. Долг РОС после оплаты. */
export function clientDebt(_c: Client, s: ClientStats | undefined): number {
  // Округляем ЗДЕСЬ: копейки от округления сумм давали «долг €0» в
  // карточке и ложное попадание в статус «Должники».
  return Math.round(s?.debt ?? 0);
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
  | "serviceDue"
  | "unclosed"
  | "booked"
  | "noUpcoming"
  | "reminderDue"
  | "silent"
  | "neverCame"
  | "birthday"
  | "loyal"
  | "blacklist";

/** Конкретный статус (без служебного «all») — единица мультивыбора. */
export type SegmentKey = Exclude<Segment, "all">;

/** Блоки попапа «Статус» (грамматика попапа периода — деление без
 *  подписей): «дела» диспетчера на постоянных местах · «портрет» клиента.
 *  Все ряды видны всегда; при нуле — пригашены. */
export const SEGMENT_BLOCKS: SegmentKey[][] = [
  [
    "unclosed",
    "serviceDue",
    "debt",
    "debtNoUpcoming",
    "silent",
    "noUpcoming",
    "reminderDue",
    "birthday",
  ],
  ["booked", "neverCame", "loyal", "blacklist"],
];

/** Статусы-ПОВОДЫ СВЯЗАТЬСЯ: из них вычитается чёрный список. Держится
 *  отдельно от `SEGMENT_BLOCKS` (раскладка) — правило не должно зависеть от
 *  того, в каком блоке ряд нарисован. */
export const OUTREACH_SEGMENTS: SegmentKey[] = [
  "unclosed",
  "serviceDue",
  "debt",
  "debtNoUpcoming",
  "silent",
  "noUpcoming",
  "reminderDue",
  "birthday",
];

/** Имена блоков (владелец 2026-08-07). Две безымянные карточки читались как
 *  случайный разрыв списка: почему «Давно не приезжали» отдельно от «Без
 *  следующей записи», глазу не объясняли. Заголовок называет, ЗАЧЕМ ряд:
 *  сверху — повод связаться сегодня, снизу — каким этот человек бывает
 *  вообще. */
export const SEGMENT_BLOCK_TITLES: string[] = [
  "Есть повод связаться",
  "Какой это клиент",
];


/** Порядок (деньги/действие вперёд) + RU-подписи.
 *
 *  ЗАКОН ПОДПИСИ (владелец 2026-07-25): подпись описывает РОВНО тот
 *  предикат, что стоит рядом в matchesSegment, — иначе фильтр врёт.
 *
 *  ФОРМА ПОДПИСИ (владелец 2026-08-07: «не нравится, как написано, звучит
 *  странно»): строка — ОТВЕТ НА ВОПРОС «кого показать», то есть признак
 *  человека, а не команда диспетчеру. «Пора дозаписать» звучало как задача
 *  («дозаписать» — вообще не русский глагол в этом смысле) и не отвечало на
 *  вопрос списка; «Долг, не записан» читалось телеграфной строкой. Теперь
 *  все ряды — однородные именные группы: «Должники», «Без следующей
 *  записи», «Так и не приехали». Читается подряд как перечень людей.
 *
 *  Под каждой строкой печатается ПРАВИЛО (SEGMENT_RULES) — без него
 *  «Постоянные» не говорит, сколько это визитов. */
/** Пороги статусов — в одном месте: их называют подписи и правила рядов. */
/** Во сколько раз клиент должен просрочить СВОЙ обычный интервал, чтобы
 *  считаться пропавшим (владелец 2026-08-07 выбрал личный ритм вместо
 *  общего порога: «клининг раз в неделю и кондиционеры раз в полгода не
 *  меряются одной цифрой»). */
export const SILENCE_RHYTHM_FACTOR = 2;
/** Границы личного ритма. Медиана по сырым визитам бывает бессмысленной:
 *  два выезда в один день или подряд дают «раз в 1 день», и человек
 *  становился «пропавшим» через двое суток. Снизу — две недели, сверху —
 *  полгода: дольше ждать возврата бессмысленно, это уже не пауза. */
export const RHYTHM_MIN_DAYS = 14;
export const RHYTHM_MAX_DAYS = 180;

/** Ритм клиента, приведённый к разумным границам (см. константы выше). */
export function clientRhythmDays(s: ClientStats | undefined): number | null {
  const raw = s?.medianGapDays ?? null;
  if (raw === null) return null;
  return Math.min(RHYTHM_MAX_DAYS, Math.max(RHYTHM_MIN_DAYS, raw));
}
/** Фолбэк для тех, у кого ритма ещё нет (один визит): единственное место,
 *  где остаётся общая цифра. */
export const SILENCE_DAYS = 60;
export const NEW_DAYS = 30; // «Так и не приехали» — возраст карточки
export const LOYAL_VISITS = 5; // «Постоянные»
export const BIRTHDAY_DAYS = 14; // «Скоро день рождения»

export const SEGMENT_OPTIONS: { key: SegmentKey; label: string }[] = [
  { key: "unclosed", label: "Визит не закрыт" },
  { key: "serviceDue", label: "Пора обслужить" },
  { key: "debt", label: "Должники" },
  { key: "debtNoUpcoming", label: "Должники без новой записи" },
  { key: "silent", label: "Пропали" },
  { key: "noUpcoming", label: "Без следующей записи" },
  { key: "reminderDue", label: "Напоминание на сегодня" },
  { key: "birthday", label: "Скоро день рождения" },
  { key: "booked", label: "Записаны вперёд" },
  { key: "neverCame", label: "Так и не приехали" },
  { key: "loyal", label: "Постоянные" },
  { key: "blacklist", label: "Чёрный список" },
];

/** ПРАВИЛО ПОД КАЖДЫМ СТАТУСОМ (владелец 2026-08-07: «как пользователь
 *  должен убеждаться, что это правильные статусы»). Так делают и Bumpix, и
 *  DIKIDI: под именем сегмента — предложение, описывающее предикат. Пока
 *  правила не было, «Постоянные» означало неизвестно сколько визитов, а
 *  «с долгом и без записи» читалось как «долг без визитов».
 *
 *  Цифры подставляются из тех же констант, что считает `matchesSegment`, —
 *  иначе смена порога сделает подпись ложью. */
export const SEGMENT_RULES: Record<SegmentKey, string> = {
  unclosed: "Дата визита прошла, а запись всё ещё «запланирована»",
  serviceDue: "Прошёл интервал обслуживания объекта",
  debt: "Есть недоплата по завершённым визитам",
  debtNoUpcoming: "Есть недоплата, и следующий визит не назначен",
  silent: "Не приезжает дольше своего обычного срока",
  noUpcoming: "Визиты были, следующий не назначен",
  reminderDue: "Вы поставили напоминание, и срок наступил",
  birthday: `День рождения в ближайшие ${BIRTHDAY_DAYS} дней`,
  booked: "Есть назначенный визит впереди",
  neverCame: `Заведён ${NEW_DAYS}+ дней назад, ни разу не приезжал`,
  loyal: `${LOYAL_VISITS} и больше завершённых визитов`,
  blacklist: "Отмечен в чёрном списке",
};

export function todayYMD(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}


/** УЛИКА: почему ЭТОТ человек попал в выбранный статус.
 *
 *  Владелец 2026-08-07: «как пользователь должен смотреть и убеждаться, что
 *  это правильные статусы». Правило под именем статуса объясняет ОТБОР;
 *  улика доказывает КАЖДУЮ строку списка: выбрал «Пропали» — и у одного
 *  «не был 87 дней», у другого «не был 140 дней», и все за своим сроком.
 *
 *  Печатается только для статусов, где число неочевидно: у должника сумма
 *  уже стоит в строке, у чёрного списка — значок, и повторять их значило бы
 *  сказать одно и то же дважды. Возвращается для ПЕРВОГО совпавшего
 *  статуса в каноническом порядке — заодно отвечает на вопрос «за какой из
 *  выбранных он сюда попал». */
export function segmentEvidence(
  c: Client,
  keys: readonly SegmentKey[],
  s: ClientStats | undefined,
  today: string = todayYMD(),
): string | null {
  if (keys.length === 0) return null;
  for (const o of SEGMENT_OPTIONS) {
    if (!keys.includes(o.key)) continue;
    if (!matchesSegment(c, o.key, s, today)) continue;
    switch (o.key) {
      case "unclosed": {
        const n = s?.unclosedVisits ?? 0;
        return `${n} ${countWordRu(n, "визит не закрыт", "визита не закрыты", "визитов не закрыто")}`;
      }
      case "serviceDue": {
        const n = s?.serviceDue ?? 0;
        return n === 1
          ? "объект просрочен"
          : `${n} ${countWordRu(n, "объект просрочен", "объекта просрочены", "объектов просрочено")}`;
      }
      case "silent": {
        const days = s?.lastVisitDays ?? 0;
        // Печатаем СЫРУЮ медиану — она про этого человека. Зажатое
        // значение (14..180) участвует только в отборе; выдавать границу
        // за наблюдение нельзя: у клиента с медианой 3 дня «обычно раз в
        // 14 дн.» — неправда о нём.
        const raw = s?.medianGapDays ?? null;
        return raw
          ? `не был ${days} дн. · обычно раз в ${raw} дн.`
          : `не был ${days} дн.`;
      }
      case "noUpcoming":
        return s?.lastVisitDate
          ? `был ${s.lastVisitDate.slice(8, 10)}.${s.lastVisitDate.slice(5, 7)} · вперёд не записан`
          : "вперёд не записан";
      case "booked":
        return s?.nextApt
          ? `придёт ${s.nextApt.date.slice(8, 10)}.${s.nextApt.date.slice(5, 7)}`
          : null;
      case "neverCame":
        return `заведён ${s?.ageDays ?? 0} дн. назад, визитов нет`;
      case "loyal": {
        const n = s?.visits ?? 0;
        return `${n} ${countWordRu(n, "визит", "визита", "визитов")}`;
      }
      case "birthday": {
        const d = s?.birthdayInDays ?? 0;
        return d === 0 ? "день рождения сегодня" : `день рождения через ${d} дн.`;
      }
      // Долг, напоминание и чёрный список уже видны в самой строке своими
      // значками и суммой. Не возвращаем null сразу: у клиента может быть
      // выбран и второй статус, которому есть что сказать («не был 87 дн.»).
      default:
        break;
    }
  }
  return null;
}

/** Проходит ли клиент один конкретный статус — единый предикат для
 *  фильтра (ИЛИ по выбранным: «любой из выбранных») и для счётчиков рядов.
 *  `today` передаётся снаружи: это горячий цикл (N клиентов × 12 статусов),
 *  и «сегодня» не должно плыть по ходу одного прохода. */
export function matchesSegment(
  c: Client,
  key: SegmentKey,
  s: ClientStats | undefined,
  today: string = todayYMD(),
): boolean {
  // ЧЁРНЫЙ СПИСОК ВЫЧИТАЕТСЯ ИЗ ПОВОДОВ СВЯЗАТЬСЯ (аудит 2026-08-07: «чёрный
  // список ничего не исключает»). Отметить человека и продолжать выдавать
  // его в списки на обзвон и в поздравления — значит сделать отметку
  // бессмысленной. Из «портрета» (каким клиент бывает) он не вычитается:
  // там ряд «Чёрный список» и есть способ его увидеть.
  //
  // Список ЯВНЫЙ, а не `SEGMENT_BLOCKS[0]`: тот массив — раскладка попапа,
  // и перестановка ряда между блоками ради вёрстки молча меняла бы отбор
  // (увёл «День рождения» вниз — забаненные снова получают поздравления).
  //
  // Деньги при этом считаются по-прежнему: долг забаненного никуда не
  // делся, он виден в карточке, в сумме и в Финансах. Мы убираем его из
  // СПИСКА НА ОБЗВОН, а не из бухгалтерии.
  if (c.blacklisted && OUTREACH_SEGMENTS.includes(key)) return false;
  switch (key) {
    case "unclosed":
      // Работа сделана вчера, а запись не закрыта: денег нет ни в долге, ни
      // в выручке, и человек выглядит тем, кто «так и не приехал».
      return (s?.unclosedVisits ?? 0) > 0;
    case "booked":
      // Единственный ПОЛОЖИТЕЛЬНЫЙ ряд: кому звонить подтвердить визит.
      return (s?.nextApt ?? null) !== null;
    case "debt":
      // Тот же долг, что печатается в карточке и сортирует ось «Долг» —
      // одна формула на все три места.
      return clientDebt(c, s) > 0;
    case "debtNoUpcoming":
      // Должен и больше не придёт — деньги уходят.
      return clientDebt(c, s) > 0 && (s?.nextApt ?? null) === null;
    case "serviceDue":
      // ПОРА ОБСЛУЖИТЬ — по интервалу самого объекта, а не по общей цифре.
      // Единственный статус, предсказывающий выручку следующего месяца:
      // регулярное обслуживание и есть основной доход сервиса.
      return (s?.serviceDue ?? 0) > 0;
    case "noUpcoming":
      // Был визит, но следующего нет (реактивация).
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
      // ПРОПАЛ ПО СВОЕМУ РИТМУ. У кого есть история — сравниваем с его
      // медианным интервалом (ездит раз в месяц → тревога на третьем);
      // у кого визит один и ритма ещё нет — общий фолбэк.
      if (!s) return false;
      {
        const rhythm = clientRhythmDays(s);
        if (rhythm !== null) {
          return (
            s.nextApt === null &&
            (s.lastVisitDays ?? 0) >= rhythm * SILENCE_RHYTHM_FACTOR
          );
        }
      }
      return isLongSilence(s, SILENCE_DAYS);
    case "birthday": {
      const dd = s?.birthdayInDays ?? null;
      return dd !== null && dd <= BIRTHDAY_DAYS;
    }
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
  segment: "Можно выбрать несколько",
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
