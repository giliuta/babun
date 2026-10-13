import type { Client } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import {
  isLongSilence,
  isLoyalClient,
} from "@babun/shared/local/selectors/client-stats";
import { countWordRu } from "@babun/shared/common/utils/pluralize";
import { clientDebt } from "./sort";

// Status segments: options, rules, thresholds, the predicate and its
// per-row evidence. Pure, no React.

// ── Segments (Статус) ──────────────────────────────────────────────

export type Segment =
  | "all"
  | "debt"
  | "debtNoUpcoming"
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
const SILENCE_RHYTHM_FACTOR = 2;
/** Границы личного ритма. Медиана по сырым визитам бывает бессмысленной:
 *  два выезда в один день или подряд дают «раз в 1 день», и человек
 *  становился «пропавшим» через двое суток. Снизу — две недели, сверху —
 *  полгода: дольше ждать возврата бессмысленно, это уже не пауза. */
const RHYTHM_MIN_DAYS = 14;
const RHYTHM_MAX_DAYS = 180;

/** Ритм клиента, приведённый к разумным границам (см. константы выше). */
function clientRhythmDays(s: ClientStats | undefined): number | null {
  const raw = s?.medianGapDays ?? null;
  if (raw === null) return null;
  return Math.min(RHYTHM_MAX_DAYS, Math.max(RHYTHM_MIN_DAYS, raw));
}
/** Фолбэк для тех, у кого ритма ещё нет (один визит): единственное место,
 *  где остаётся общая цифра. */
const SILENCE_DAYS = 60;
export const NEW_DAYS = 30; // «Так и не приехали» — возраст карточки
export const LOYAL_VISITS = 5; // «Постоянные»
export const BIRTHDAY_DAYS = 14; // «Скоро день рождения»

export const SEGMENT_OPTIONS: { key: SegmentKey; label: string }[] = [
  { key: "unclosed", label: "Визит не закрыт" },
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
