import type { Appointment } from "@babun/shared/local/appointments";
import { money } from "@babun/shared/common/utils/money";
import {
  signedAmount,
  type FinanceTransaction,
} from "@babun/shared/local/finance/transaction";
import {
  FORMS_DEN,
  FORMS_PLATEZH,
  formatCountRu,
} from "@babun/shared/common/utils/plural-ru";
import { payeeName, withPayee } from "./category-asks";

// ОДИН ВИЗИТ — ОДНА СТРОКА (владелец 2026-09-08: «нам без разницы, предоплата,
// доплата или переплата: это всё единая сумма, зафиксированная за этой
// записью»).
//
// Лента операций — это лента ПРОВОДОК: визит с предоплатой и доплатой даёт в
// ней две строки, частичный возврат — третью, и в разрезе «Доход» человек
// видит одну работу трижды. Здесь проводки одного `appointment_id` сходятся в
// одну строку: клиент титулом, услуги подстрокой, сумма визита справа.
//
// Доход и расход НЕ схлопываются между собой (владелец там же: «доход 135
// стоит целиком, расход 10 стоит целиком, а в прибыли уже 135 − 10»). Эта
// функция считает ОДИН разрез: что ей дали, то и сложила. Вычитание живёт в
// плитке «Прибыль», а не здесь.
//
// Проводка без записи (бензин, обеды, зарплата) остаётся сама собой: у неё
// нет ни клиента, ни услуг, и шаблон «клиент + услуги» сложился бы для неё с
// пустыми полями. Такая строка приходит своим видом — `appointmentId: null`.

export interface RecordRow {
  /** Ключ списка: id записи либо id одиночной проводки. */
  key: string;
  /** Запись, которую откроет тап. `null` — ручная операция, записи нет. */
  appointmentId: string | null;
  /** КТО. Имя клиента; у ручной операции — категория или заметка. */
  title: string;
  /** ЧТО. Имена услуг визита в порядке записи; у ручной операции пусто. */
  services: string[];
  /** Своя вторая строка для операций без записи: заметка перевода («на
   *  бензин»), которой у них вместо услуг ничего нет. Без неё перевод
   *  печатался прочерком — «Перевод / —». */
  subtitle?: string;
  /** ЧЕРЕЗ КАКИЕ СЧЕТА ПРОШЛИ ДЕНЬГИ СТРОКИ (владелец 2026-09-15: «в каждой
   *  заявке — приход, расход, доход — писалось, откуда взялись деньги или
   *  куда ушли: наличные, карта и так далее»). Данными, а не готовой строкой:
   *  склейка записи (`mergeByRecord`) собирает счета нескольких строк, и имена
   *  обязаны встать в том же порядке, что плитки счетов, — его несёт `rank`.
   *  У перевода пары нет: «Наличные → Карта» уже стоит в `subtitle`. */
  accounts?: readonly RowAccount[];
  /** СКОЛЬКО. Нетто разреза: все проводки визита сложены со своим знаком. */
  amount: number;
  /** КОГДА. Дата визита (у ручной — дата операции), YYYY-MM-DD. */
  date: string;
  /** Время визита или операции, HH:MM. `null` — времени нет. */
  time: string | null;
  /** Сколько проводок сложилось в строку. 1 — складывать было нечего. */
  count: number;
  /** Проводка, если строка — одиночная операция без записи (бензин, обеды,
   *  перевод). Её открывают на правку, а не как визит. */
  txId?: string;
  /** Ручной долг, если строка — он. Записи за таким долгом нет: тап открывает
   *  сам долг. Живёт ЗДЕСЬ, а не только в `DebtRow`, потому что общая лента
   *  несёт долги наравне с доходом и расходом и обязана уметь их открыть. */
  debtId?: string;
  /** Правая подпись под суммой, если у списка она своя. У долга это возраст
   *  («3 дня»): дата не печатается — она уже стоит заголовком дня. */
  caption?: string;
  /** Что ещё не закрыто по этой же работе. Данными, а не готовой строкой:
   *  сумму каждого состояния строка красит его цветом. */
  extras?: RowExtra[];
  /** Направление для окраски суммы. Ставит ТОТ, КТО СМЕШИВАЕТ разрезы: на
   *  главной ленте один визит даёт и доходную строку, и расходную, и они
   *  обязаны отличаться цветом. В однородном списке не нужен.
   *
   *  «transfer» — движение между своими счетами: для прибыли оно нейтрально,
   *  и красить его зелёным нельзя. «−€55» зелёным читался как доход. */
  tone?: "income" | "expense" | "debt" | "transfer";
  /** Перевод, у которого в ленте видна ОДНА нога: вторая лежит на счёте вне
   *  среза (лента одного счёта). Для этой ленты деньги правда пришли или
   *  ушли, поэтому сумма несёт знак и входит в итог дня; цвет остаётся
   *  нейтральным — прибыли от перевода не прибавилось. */
  crossesSlice?: boolean;
}

export interface RowExtra {
  tone: NonNullable<RecordRow["tone"]>;
  amount: number;
}

/** Счёт строки: имя и место в списке счетов (`RecordRowRefs.accounts`). */
export interface RowAccount {
  name: string;
  rank: number;
}

export interface RecordRowRefs {
  appointments: readonly Appointment[];
  clients: readonly { id: string; full_name: string }[];
  services: readonly { id: string; name: string }[];
  categories: readonly { id: string; name: string }[];
  /** Счета — чтобы строка сказала, ОТКУДА деньги или КУДА ушли. Порядок
   *  списка — порядок имён в строке («Наличные · Карта»), поэтому сюда
   *  отдают счета в порядке плиток. Закрытые тоже: операция периода могла
   *  пройти через счёт, который с тех пор закрыли, и имя у неё осталось. */
  accounts?: readonly { id: string; name: string }[];
  /** Сотрудники — получатель выплаты в заголовке: «Зарплата · Даня». */
  people?: readonly { id: string; full_name: string }[];
}

/** Имена услуг визита. Снимок в записи сильнее каталога: услугу могли
 *  переименовать или удалить, а на бумаге визита осталось имя того дня. */
export function appointmentServiceNames(
  appointment: Appointment,
  catalog: Map<string, string>,
): string[] {
  const fromSnapshot = (appointment.services ?? [])
    .map((s) => s.serviceName?.trim() || catalog.get(s.serviceId) || "")
    .filter(Boolean);
  if (fromSnapshot.length > 0) return fromSnapshot;
  return (appointment.service_ids ?? [])
    .map((id) => catalog.get(id) ?? "")
    .filter(Boolean);
}

/**
 * ДВИЖЕНИЕ ДЕНЕГ ПО СТРОКАМ ЛЕНТЫ — одно правило на итог дня и на оборот
 * выбранного счёта за период (владелец 2026-09-23, идея из отчёта по счетам).
 *
 * Складывается только пришедшее и ушедшее. Долг ещё не пришёл, а перевод,
 * обе ноги которого в ленте, переехал между показанными счетами — денег от
 * него не прибавилось. Перевод с одной ногой в ленте (`crossesSlice`) — для
 * этой ленты настоящий приход или расход и входит.
 *
 * `countEveryTone` — однородный список (долги): там сумма строк и есть итог.
 * Считается в центах: сумма десятков строк иначе копит float-пыль.
 */
export function rowsNet(
  rows: readonly Pick<RecordRow, "amount" | "tone" | "crossesSlice">[],
  countEveryTone = false,
): number {
  let cents = 0;
  for (const row of rows) {
    if (
      !countEveryTone
      && (row.tone === "debt" || (row.tone === "transfer" && !row.crossesSlice))
    ) {
      continue;
    }
    cents += Math.round(row.amount * 100);
  }
  return cents / 100;
}

export function recordRows(
  transactions: readonly FinanceTransaction[],
  refs: RecordRowRefs,
): RecordRow[] {
  const appointment = new Map(refs.appointments.map((a) => [a.id, a]));
  const client = new Map(refs.clients.map((c) => [c.id, c.full_name]));
  const catalog = new Map(refs.services.map((s) => [s.id, s.name]));
  const category = new Map(refs.categories.map((c) => [c.id, c.name]));
  const account = new Map((refs.accounts ?? []).map((a) => [a.id, a.name]));
  const accountRank = new Map((refs.accounts ?? []).map((a, i) => [a.id, i]));
  /** Счета строки по id проводок. Неизвестный счёт молчит: печатать «счёт»
   *  рядом с услугами — сказать меньше, чем ничего. */
  const accountTags = (
    ids: Iterable<string | null>,
  ): RowAccount[] | undefined => {
    const tags: RowAccount[] = [];
    for (const id of ids) {
      const name = id ? account.get(id) : undefined;
      const rank = id ? accountRank.get(id) : undefined;
      if (name !== undefined && rank !== undefined) tags.push({ name, rank });
    }
    return tags.length > 0 ? tags : undefined;
  };

  const byRecord = new Map<string, RecordRow>();
  /** Счета визита копятся по мере сложения его проводок. */
  const recordAccounts = new Map<string, Set<string | null>>();
  const rows: RecordRow[] = [];

  // ПЕРЕВОД — ОДНА ОПЕРАЦИЯ, А НЕ ДВЕ (владелец 2026-09-10: «это как будто
  // сразу две операции; лучше объединить»). В леджере он лежит парой строк —
  // минус на одном счёте, плюс на другом, — и лента печатала обе. Для человека
  // это одно движение: столько-то денег переехало отсюда туда.
  //
  // Склеиваем ТОЛЬКО когда обе ноги в срезе. Одна нога значит, что вторая
  // осталась за границей команды или счёта, и печатать её без знака —
  // спрятать, что деньги из этого среза ушли.
  const legs = new Map<string, FinanceTransaction[]>();
  for (const tx of transactions) {
    if (tx.type !== "transfer" || !tx.transfer_group_id) continue;
    const group = legs.get(tx.transfer_group_id);
    if (group) group.push(tx);
    else legs.set(tx.transfer_group_id, [tx]);
  }
  const paired = new Set<string>();
  for (const [groupId, group] of legs) {
    const out = group.find((tx) => tx.amount < 0);
    const into = group.find((tx) => tx.amount > 0);
    if (!out || !into) continue;
    for (const tx of group) paired.add(tx.id);
    const name = (id: string | null) =>
      (id ? account.get(id) : null) ?? "счёт";
    rows.push({
      key: `transfer:${groupId}`,
      appointmentId: null,
      txId: out.id,
      title: "Перевод",
      services: [],
      subtitle: `${name(out.account_id)} → ${name(into.account_id)}`,
      // Знака нет: деньги не пришли и не ушли, они переехали. Минус читался
      // бы как расход, плюс — как доход, а для прибыли перевод нейтрален.
      amount: Math.abs(out.amount),
      tone: "transfer",
      date: out.occurred_on,
      time: out.occurred_time,
      // Ног у перевода две, а перевод ОДИН: «2 платежа» под ним читалось как
      // два движения денег.
      count: 1,
    });
  }

  for (const tx of transactions) {
    if (paired.has(tx.id)) continue;
    const apt = tx.appointment_id ? appointment.get(tx.appointment_id) : null;
    // Проводка ссылается на запись, которой нет в окне периода (визит в
    // прошлом месяце, деньги в этом). Складывать её не с чем — печатаем как
    // одиночную, иначе строка потеряется вовсе.
    if (!apt) {
      const note = tx.notes?.trim() || undefined;
      // Перевод НЕ отдаёт заголовок заметке: «на бензин −€50» без слова
      // «Перевод» неотличим от расхода, хотя для прибыли строка нейтральна
      // (тот же закон, что в ленте операций).
      const categoryName = tx.category_id ? category.get(tx.category_id) : null;
      const title =
        tx.type === "transfer"
          ? "Перевод"
          : categoryName
            ? withPayee(
                categoryName,
                // Сотрудник важнее: у чаевых оба, а строка про того, кому
                // достались деньги. Нет сотрудника — клиент операции.
                payeeName(refs.people, tx.master_id) ??
                  (tx.client_id ? client.get(tx.client_id) : null),
              )
            : note || "Операция";
      rows.push({
        key: tx.id,
        appointmentId: null,
        txId: tx.id,
        title,
        services: [],
        // Заметку печатаем, только если она не повторяет заголовок: у
        // операции без категории заголовком стала сама заметка. Счёт идёт
        // своим полем и встаёт после заметки, а не вместо неё.
        subtitle: note && note !== title ? note : undefined,
        accounts: accountTags([tx.account_id]),
        tone: tx.type === "transfer" ? "transfer" : undefined,
        amount: signedAmount(tx),
        date: tx.occurred_on,
        time: tx.occurred_time,
        count: 1,
      });
      continue;
    }
    const existing = byRecord.get(apt.id);
    if (existing) {
      existing.amount += signedAmount(tx);
      existing.count += 1;
      recordAccounts.get(apt.id)?.add(tx.account_id);
      continue;
    }
    recordAccounts.set(apt.id, new Set([tx.account_id]));
    const row: RecordRow = {
      key: apt.id,
      appointmentId: apt.id,
      title:
        (apt.client_id ? client.get(apt.client_id) : null) || "Без клиента",
      services: appointmentServiceNames(apt, catalog),
      amount: signedAmount(tx),
      // Время визита, а не проводки: деньги по записи могли записать вечером,
      // но в списке работ строка стоит там, где стояла работа.
      date: apt.date,
      time: apt.time_start ? apt.time_start.slice(0, 5) : tx.occurred_time,
      count: 1,
    };
    byRecord.set(apt.id, row);
    rows.push(row);
  }

  for (const [aptId, ids] of recordAccounts) {
    const row = byRecord.get(aptId);
    if (row) row.accounts = accountTags(ids);
  }

  // Копейки после сложения нескольких платежей: 44.4 + 34.4 даёт 78.80000001.
  for (const row of rows) row.amount = Math.round(row.amount * 100) / 100;

  return rows.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    const at = a.time ?? "";
    const bt = b.time ?? "";
    if (at !== bt) return at < bt ? 1 : -1;
    return a.key < b.key ? 1 : -1;
  });
}

/** Сколько имён услуг печатаем целиком, прежде чем свернуть остаток в «+N». */
const SERVICES_SHOWN = 2;

/** ЧТО сделали — одной строкой. Усечение здесь ПРАВИЛО, а не `numberOfLines`
 *  наугад: без «+N» третья услуга съедала бы имя клиента. */
export function servicesLine(services: readonly string[]): string {
  if (services.length === 0) return "";
  const shown = services.slice(0, SERVICES_SHOWN).join(" · ");
  const rest = services.length - SERVICES_SHOWN;
  return rest > 0 ? `${shown} +${rest}` : shown;
}

/** КОГДА, ЧЕРЕЗ КАКОЙ СЧЁТ и ЧТО — одной строкой под именем клиента. Время
 *  здесь обязательно (владелец 2026-09-09: «насчёт время надо на этом
 *  обязательно»): по нему узнают работу. Дата не печатается — она заголовок
 *  дня.
 *
 *  СЧЁТ ИДЁТ ДО УСЛУГ (разбор 2026-09-15). Строка в одну линию и режется
 *  многоточием с конца; счёт в хвосте первым и срезался — «11:30 · Chimney
 *  sweeping, Duct cleaning +2 · Нал…», и слово владельца «в каждой заявке
 *  писалось, откуда взялись деньги» на обычном визите не выполнялось.
 *  Перечень услуг длинный и узнаётся по первому слову, счёт — одно-два
 *  коротких имени. */
export function whatLine(
  row: Pick<RecordRow, "time" | "services" | "subtitle" | "accounts">,
): string {
  return [
    row.time,
    accountsLine(row.accounts),
    row.subtitle || servicesLine(row.services),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Лента ОДНОГО выбранного счёта имени счёта в строках не повторяет: оно уже
 *  стоит заголовком ленты («НАЛИЧНЫЕ · 5»), а повтор одного и того же
 *  владелец не любит. Перевод своё «Наличные → Карта» держит — это не имя
 *  выбранного счёта, а куда ушли деньги. */
export function dropAccountNames(rows: readonly RecordRow[]): RecordRow[] {
  return rows.map((row) => (row.accounts ? { ...row, accounts: undefined } : row));
}

/** Имена счетов строки: каждое один раз, в порядке плиток счетов. Порядок не
 *  зависит от того, какой платёж пришёл первым, — иначе один и тот же визит
 *  читался бы то «Наличные · Карта», то «Карта · Наличные». Два счёта с одним
 *  именем в разных командах печатаются одним словом: строка называет, где
 *  деньги, а чья команда — говорит чип над экраном. */
export function accountsLine(
  accounts: readonly RowAccount[] | undefined,
): string {
  if (!accounts?.length) return "";
  const names: string[] = [];
  for (const tag of [...accounts].sort((a, b) => a.rank - b.rank)) {
    if (!names.includes(tag.name)) names.push(tag.name);
  }
  return names.join(" · ");
}

/** Сумма «как напечатано» и сумма «как хранится» — один канон для сравнения:
 *  без пробелов (лента ставит неразрывный U+00A0), без €, запятая → точка. */
const canonMoney = (s: string) => s.replace(/[\s€]/g, "").replace(/,/g, ".");

/** ПОИСК ИЩЕТ ТО, ЧТО ВИДНО В СТРОКЕ: клиент, услуги, сумма и счёт. Поле
 *  поиска обещает «Сумма, счёт, заметка», а счёт до 2026-09-15 в строке не
 *  печатался — и искать по нему было нельзя. Пустой запрос пропускает всё. */
export function rowMatchesQuery(row: RecordRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const includes = (text: string) => text.toLowerCase().includes(needle);
  return (
    includes(row.title) ||
    row.services.some(includes) ||
    (row.subtitle ? includes(row.subtitle) : false) ||
    (row.accounts ?? []).some((tag) => includes(tag.name)) ||
    canonMoney(money(Math.abs(row.amount))).includes(canonMoney(needle))
  );
}

/** Правая подпись, когда состояние одно: число платежей, если их несколько. */
export function paymentsLine(row: Pick<RecordRow, "count">): string {
  return row.count > 1 ? formatCountRu(row.count, FORMS_PLATEZH) : "";
}

/** ВОЗРАСТ ДОЛГА — ГЛАВНЫЙ ПРИЗНАК СРОЧНОСТИ. Список долгов открывают, чтобы
 *  решить, кому звонить; вчерашний долг и месячный требуют разного, а на
 *  экране без возраста они неотличимы. Дату не печатаем: она уже стоит
 *  заголовком дня, и в строке была бы вторым экземпляром того же
 *  (владелец 2026-09-09: «дата будет и так сверху»). */
export function debtAge(date: string, today: string): string {
  const days = daysBetween(date, today);
  if (days <= 0) return "сегодня";
  if (days === 1) return "вчера";
  return formatCountRu(days, FORMS_DEN);
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

// ОДНА ЗАПИСЬ — ОДНА СТРОКА, ДАЖЕ КОГДА СОСТОЯНИЙ НЕСКОЛЬКО (владелец
// 2026-09-09: «это ж не две сделки отдельно… по факту это одна была запись,
// просто в ней может быть расход, доход и долг»).
//
// В общей ленте визит с доходом и остатком долга давал ДВЕ строки, с
// материалами — три, и одна работа читалась как три дела. Та же ошибка, что с
// девятнадцатью проводками, только уровнем выше.
//
// Правило: ГЛАВНОЕ ЧИСЛО — деньги, которые ПРИШЛИ. По нему считается итог дня
// и сходится плитка «Доход»; если бы главным была стоимость работ, день
// показывал бы деньги, которых в кассе нет. Прихода не было — главным
// становится то, что есть: долг или расход. Остальные состояния той же работы
// уходят в подпись: «долг €7 · расход €10».
//
// Разрезы этой склейки НЕ используют: тапнув «Долги», человек хочет долги, а
// не записи с долгом внутри.

/** Кто главнее, когда у записи несколько состояний. Деньги, которые ПРИШЛИ,
 *  важнее всего; следом долг — он про клиента и требует действия; расход по
 *  материалам замыкает: он уже случился и решения не ждёт. */
const TONE_ORDER: NonNullable<RecordRow["tone"]>[] = [
  "income",
  "debt",
  "expense",
];

export function mergeByRecord(rows: readonly RecordRow[]): RecordRow[] {
  const byRecord = new Map<string, RecordRow[]>();
  const singles: RecordRow[] = [];

  for (const row of rows) {
    if (!row.appointmentId) {
      singles.push(row);
      continue;
    }
    const group = byRecord.get(row.appointmentId);
    if (group) group.push(row);
    else byRecord.set(row.appointmentId, [row]);
  }

  const merged = [...byRecord.values()].map((group) => {
    if (group.length === 1) return group[0];
    // Одно состояние может прийти несколькими строками (доход и его же
    // материалы уже сложены раньше, но подстраховка дешевле разъехавшейся
    // суммы): складываем внутри тона, потом выбираем главный.
    const sums = new Map<NonNullable<RecordRow["tone"]>, number>();
    for (const row of group) {
      const tone = row.tone ?? "income";
      sums.set(tone, (sums.get(tone) ?? 0) + row.amount);
    }
    const present = TONE_ORDER.filter((tone) => sums.has(tone));
    const headTone = present[0];
    const head =
      group.find((row) => (row.tone ?? "income") === headTone) ?? group[0];
    const extras = present.slice(1).map((tone) => ({
      tone,
      amount: Math.abs(sums.get(tone) ?? 0),
    }));
    // Счета склеенной строки — все, через которые шли деньги этой работы:
    // доход пришёл на карту, материалы ушли наличными — «Наличные · Карта».
    const accounts = group.flatMap((row) => row.accounts ?? []);
    return {
      ...head,
      accounts: accounts.length > 0 ? accounts : undefined,
      key: `rec:${head.appointmentId}`,
      amount: Math.round((sums.get(headTone) ?? 0) * 100) / 100,
      tone: headTone,
      // Подпись уступает место тому, что ещё не закрыто: возраст человек
      // прикинет по дню списка, а «сколько ещё должны» — нет.
      caption: extras.length > 0 ? undefined : head.caption,
      extras: extras.length > 0 ? extras : undefined,
      count: group.reduce((sum, row) => sum + row.count, 0),
    };
  });

  return [...merged, ...singles].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    const at = a.time ?? "";
    const bt = b.time ?? "";
    if (at !== bt) return at < bt ? 1 : -1;
    return a.key < b.key ? 1 : -1;
  });
}
