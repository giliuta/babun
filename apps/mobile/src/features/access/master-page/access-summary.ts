// РАЗДЕЛЫ ПРАВ КОМАНДЫ — РАЗДЕЛЫ ПРИЛОЖЕНИЯ (владелец 29.09). В реестре
// календарные права лежат одним разделом «Записи», а владелец думает
// разделами приложения: что человек может в КАЛЕНДАРЕ (новые записи, перенос,
// события, метки дня, график), что в ЗАПИСИ (клиент, объект, услуги, оплата…),
// в ФИНАНСАХ и с КЛИЕНТАМИ. Группа — по началу ключа блока.

export type CalendarGroup = "calendar" | "record" | "finance" | "clients";

// Порядок разделов — слово владельца 01.10: «Календарь, Клиенты, Финансы,
// Компания».
export const CALENDAR_GROUPS: readonly CalendarGroup[] = ["calendar", "record", "clients", "finance"];

/** Блок в разделе: «clients» — сам блок `clients` и его `clients.*`.
 *  Блоки события (`event.*`) — вместе с блоками записи; на странице прав оба
 *  стоят блоками «Календаря» (`SECTION_BLOCKS.calendar`). */
export function inGroup(key: string, group: CalendarGroup): boolean {
  if (group === "record" && key.startsWith("event.")) return true;
  return key === group || key.startsWith(`${group}.`);
}

export const CALENDAR_GROUP_TITLE: Record<CalendarGroup, string> = {
  calendar: "Календарь",
  record: "Запись",
  finance: "Финансы",
  // С 29.09 клиенты — право команды (миграция `clients_rights_per_team`).
  clients: "Клиенты",
};

/** ПРАВА ЗАПИСИ — В ПОРЯДКЕ БЛОКОВ СТРАНИЦЫ ЗАПИСИ (`BOOKING_BLOCKS`:
 *  команда, метка, время, клиент, объект, услуги, оплата, заметка, файлы).
 *  Цвет — к метке (оба про вид записи в сетке), цены — сразу под услугами,
 *  статус со своей заметкой — на месте заметки. Время записи правит
 *  «Переносить» раздела «Календарь». */
export const RECORD_ROW_ORDER: readonly string[] = [
  "record.team",
  "record.label",
  "record.when",
  "record.color",
  "record.client",
  "record.object",
  "record.services",
  "record.amount",
  "record.payment",
  "record.status",
  "record.note",
  "record.files",
];

/** БЛОКИ СОБЫТИЯ — в порядке страницы события: метка, тип, клиент, объект,
 *  заметка, файлы. Команда и время видны всегда; двигает событие его автор
 *  при «Записи событий: Видит и создаёт». */
export const EVENT_ROW_ORDER: readonly string[] = [
  "event.label",
  "event.type",
  "event.client",
  "event.object",
  "event.note",
  "event.files",
];

/** ПРАВА КАЛЕНДАРЯ. Метка дня — первой (владелец 29.09: «поставь метку
 *  первым»), дальше — что он делает с записями (новые, перенос, отмена) и что
 *  видит вокруг них (события, график). */
export const CALENDAR_ROW_ORDER: readonly string[] = [
  "calendar.day_labels",
  "calendar.records",
  "calendar.create",
  "calendar.events",
  "calendar.move",
  "calendar.cancel",
  "calendar.schedule",
];

/** БЛОКИ НА СТРАНИЦЕ РАЗДЕЛА ДОСТУПА (владелец 29.09: «первый блок —
 *  главное календаря, потом второй блок — свои значения, третий — свои»).
 *  Карточка со своей шапкой на каждый блок; право, не вошедшее ни в один,
 *  встаёт последней карточкой без шапки. У раздела без блоков — одна
 *  карточка без шапки: имя раздела уже в шапке страницы. */
export interface SectionBlock {
  key: string;
  title: string;
  keys: readonly string[];
}

/** Блоки страницы клиента — в порядке самой страницы (заметка под
 *  «Клиентом», люди, объекты, файлы, метка и тег, личное, реквизиты, долг и
 *  деньги). В строке списка с 01.10 только имя, номер и последняя запись. */
export const CLIENT_CARD_ROW_ORDER: readonly string[] = [
  "clients.note",
  "clients.people",
  "clients.objects",
  "clients.files",
  "clients.labels",
  "clients.personal",
  "clients.requisites",
  "clients.money",
];

/** Права блока «Записи» на странице «Календарь». */
const RECORD_KINDS: readonly string[] = [
  "calendar.records",
  "calendar.events",
  "calendar.move",
  "calendar.cancel",
];

export const SECTION_BLOCKS: Partial<Record<CalendarGroup, readonly SectionBlock[]>> = {
  // «КЛИЕНТЫ» — БЛОКАМИ, КАК «КАЛЕНДАРЬ» (владелец 30.09: «разобраться, как
  // правильно показывать»; защита базы от подрядчика со своей компанией).
  // «Карточка клиента» — по строке на каждый блок карточки, как «Запись
  // клиента» в «Календаре» (владелец 30.09: «страница клиентов по правам —
  // полностью, максимум»). Скрыты «Карточки клиентов» — все строки серые.
  clients: [
    // «ГЛАВНОЕ» — ЧТО ОН ВИДИТ, ОТКРЫВ «КЛИЕНТОВ» (владелец 01.10: «что будет
    // видеть на карточке клиентов сразу, когда открывает: последняя запись,
    // номер телефона… может ли он переходить в это»): база и «Ограничение по
    // времени». С 02.10 переход на страницу, номер, историю записей и
    // карточку из записи даёт сама база — отдельных строк у них нет. Денег,
    // команды, метки и тегов в строке нет (01.10) — они в «Карточке клиента».
    {
      key: "main",
      title: "Главное",
      keys: [
        "clients",
        "clients.scope",
      ],
    },
    // Блоки, которые есть только на странице клиента.
    { key: "card", title: "Карточка клиента", keys: CLIENT_CARD_ROW_ORDER },
    // НАСТРОЙКИ КЛИЕНТОВ — по строке на каждую строку шестерёнки клиентов
    // (владелец 01.10: «в настройках он может редактировать или не может…
    // как форма записи — поблочно»), как «Настройки команды» у календаря.
    {
      key: "settings",
      title: "Настройки клиентов",
      // В порядке строк шестерёнки клиентов.
      keys: [
        "clients.settings_card",
        "clients.settings_ways",
        "clients.settings_maps",
        "clients.settings_objects",
        "clients.settings_tags",
      ],
    },
  ],
  calendar: [
    // Доходы и расходы — в «Главном» (владелец 30.09: «переходим к доход
    // расход — в главный»): полоса денег под календарём и деньги дня. После
    // среза 2а это два права — «Доходы» и «Расходы», — место у них то же.
    {
      key: "main",
      title: "Главное",
      keys: [
        "calendar.day_labels",
        "finance.operations",
        "finance.income",
        "finance.expense",
      ],
    },
    // Записи клиентов и событий, перенос и отмена — своим блоком «Записи»
    // (владелец 30.09: «создай второй блок — „Записи"»; «событие тоже
    // опускаем»; «перенос записи и отмена переносим также в записи»).
    { key: "records", title: "Записи", keys: RECORD_KINDS },
    // БЛОКИ ВНУТРИ ЗАПИСИ И СОБЫТИЯ — ЗДЕСЬ ЖЕ, ПОД «ЗАПИСЯМИ» (владелец
    // 30.09: «запись, я думаю, надо перенести в блок „Календарь“»). Скрыты
    // «Записи клиентов» — блока «Запись клиента» нет; скрыты «Записи
    // событий» — нет блока «Событие» (`DEPENDANT_BLOCKS`).
    { key: "record", title: "Запись клиента", keys: RECORD_ROW_ORDER },
    { key: "event", title: "Событие", keys: EVENT_ROW_ORDER },
    // НАСТРОЙКИ КОМАНДЫ — по строке на каждую функцию шестерёнки календаря
    // (владелец 30.09: «может менять часовой пояс, не может график менять и
    // так далее — полностью все функции, которые в настройках»). Строка
    // встаёт сюда, когда сервер начинает проверять её право.
    {
      key: "settings",
      title: "Настройки команды",
      // В порядке строк шестерёнки календаря.
      keys: [
        "calendar.identity",
        "calendar.timezone",
        "calendar.hours",
        "calendar.schedule",
        "calendar.booking_form",
        "calendar.services",
        "calendar.labels",
      ],
    },
  ],
};

/** Порядок строк раздела: запись — как на её странице, календарь — от
 *  частого к редкому, прочие — реестр. */
export function orderGroupRows<T extends { block: { key: string } }>(
  group: CalendarGroup | undefined,
  rows: readonly T[],
): T[] {
  const order = group === "record" ? RECORD_ROW_ORDER : group === "calendar" ? CALENDAR_ROW_ORDER : null;
  if (!order) return [...rows];
  const rank = (key: string) => {
    const at = order.indexOf(key);
    return at === -1 ? order.length : at;
  };
  return [...rows].sort((a, b) => rank(a.block.key) - rank(b.block.key));
}
