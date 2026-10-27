// РАЗДЕЛЫ ПРАВ КОМАНДЫ — РАЗДЕЛЫ ПРИЛОЖЕНИЯ. В реестре
// календарные права лежат одним разделом «Записи», а владелец думает
// разделами приложения: что человек может в КАЛЕНДАРЕ (новые записи, перенос,
// события, метки дня, график), что в ЗАПИСИ (клиент, объект, услуги, оплата…),
// в ФИНАНСАХ и с КЛИЕНТАМИ. Группа — по началу ключа блока.

export type CalendarGroup = "calendar" | "record" | "finance" | "clients";

// Порядок разделов: Календарь, Клиенты, Финансы, Компания.
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
  // Клиенты — право команды (миграция `clients_rights_per_team`).
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
  "record.note",
  "record.files",
  // «SMS» внизу записи — последним, как и на странице.
  "record.sms",
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

/** ПРАВА КАЛЕНДАРЯ. Метка дня — первой, дальше — что он делает с записями (новые, перенос, отмена) и что
 *  видит вокруг них (события, график). */
export const CALENDAR_ROW_ORDER: readonly string[] = [
  "calendar.day_labels",
  "calendar.records",
  "calendar.window",
  "calendar.create",
  "calendar.events",
  "calendar.move",
  "calendar.cancel",
  // Доход и расход дня под сеткой.
  "calendar.day_money",
  "calendar.schedule",
];

/** БЛОКИ НА СТРАНИЦЕ РАЗДЕЛА ДОСТУПА: первый блок — главное календаря, дальше
 *  у каждого блока свои значения. Карточка со своей шапкой на каждый блок; право, не вошедшее ни в один,
 *  встаёт последней карточкой без шапки. У раздела без блоков — одна
 *  карточка без шапки: имя раздела уже в шапке страницы. */
export interface SectionBlock {
  key: string;
  title: string;
  keys: readonly string[];
}

/** Блоки страницы клиента — в порядке самой страницы: Метка и тег (они
 *  самым верхом карточки), Клиент, Заметка, Люди, История (и долг с деньгами
 *  в ней), Объекты, Файлы, Реквизиты, Личное, SMS. В строке списка только имя,
 *  номер и последняя запись. */
export const CLIENT_CARD_ROW_ORDER: readonly string[] = [
  // В ПОРЯДКЕ БЛОКОВ СТРАНИЦЫ КЛИЕНТА (метка и тег — самым верхом карточки,
  // и здесь первыми).
  "clients.labels",
  "clients.tags",
  "clients.client",
  "clients.note",
  "clients.people",
  "clients.history",
  "clients.objects",
  "clients.files",
  "clients.requisites",
  "clients.personal",
  "clients.sms",
];

/** «ФИНАНСЫ» — В ПОРЯДКЕ ПЛИТОК СТРАНИЦЫ:
 *  Счета · Документы · Доход · Расход · Долги · Прибыль. «Доход» и «Расход»
 *  переехали сюда из «Главного» календаря — право то же, оно же открывает
 *  деньги дня в календаре. */
export const FINANCE_ROW_ORDER: readonly string[] = [
  "finance.accounts",
  "finance.documents",
  "finance.income",
  "finance.expense",
  // «Ограничения» — под доходами и расходами, которые они режут.
  "finance.window",
  "finance.debts",
];

/** ШЕСТЕРЁНКА «ФИНАНСОВ» — БЛОКАМИ, КАК НА НЕЙ САМОЙ («Деньги · Категории ·
 *  Документы · Общие»), по строке на каждую. Каждый блок прав — блок шестерёнки, в её
 *  порядке; право, которого ещё нет в реестре, строкой не встаёт. */
export const FINANCE_SETTINGS_BLOCKS: readonly SectionBlock[] = [
  {
    key: "money",
    title: "Деньги",
    keys: ["finance.settings_accounts", "finance.settings_trash"],
  },
  {
    key: "categories",
    title: "Категории",
    keys: [
      "finance.settings_categories_income",
      "finance.settings_categories_expense",
      "finance.settings_categories_debts",
    ],
  },
  // «Реквизиты» ушли из шестерёнки в Кабинет — их право теперь в
  // разделе «Кабинет» (`CABINET_ROW_ORDER`).
  { key: "general", title: "Общие", keys: ["finance.settings_currency"] },
];

/** РАЗДЕЛ «КАБИНЕТ» (доступ к реквизитам, тарифу, SMS, оплате): права аккаунта в порядке строк Кабинета.
 *  Право, которого нет в списке, встаёт после них. */
export const CABINET_ROW_ORDER: readonly string[] = [
  "cabinet.tariff",
  "cabinet.tariff_payments",
  "cabinet.sms",
  "finance.settings_requisites",
  "cabinet.history",
  "company.partners",
];

export function orderCabinetRows<T extends { block: { key: string } }>(rows: readonly T[]): T[] {
  const rank = (key: string) => {
    const at = CABINET_ROW_ORDER.indexOf(key);
    return at === -1 ? CABINET_ROW_ORDER.length : at;
  };
  return [...rows].sort((a, b) => rank(a.block.key) - rank(b.block.key));
}

/** Права блока «Записи» на странице «Календарь». */
const RECORD_KINDS: readonly string[] = [
  "calendar.records",
  // «Ограничения» — сразу под «Записями клиентов», как у клиентов
  // «Ограничения» под «Базой».
  "calendar.window",
  "calendar.events",
  "calendar.move",
  "calendar.cancel",
  // ДОХОД И РАСХОД ДНЯ — В «ГЛАВНОМ» КАЛЕНДАРЯ: полоса под сеткой и лист
  // «Финансы дня». Доходы и расходы «Финансов» — свои строки в «Финансах».
  "calendar.day_money",
];

export const SECTION_BLOCKS: Partial<Record<CalendarGroup, readonly SectionBlock[]>> = {
  // «КЛИЕНТЫ» — БЛОКАМИ, КАК «КАЛЕНДАРЬ» (защита базы от подрядчика со своей
  // компанией). «Карточка клиента» — по строке на каждый блок карточки, как
  // «Запись клиента» в «Календаре». Скрыты «Карточки клиентов» — все строки серые.
  clients: [
    // «ГЛАВНОЕ» — ЧТО ОН ВИДИТ, ОТКРЫВ «КЛИЕНТОВ»: база и «Ограничение по
    // времени». Переход на страницу, номер, историю записей и карточку из
    // записи даёт сама база — отдельных строк у них нет. Денег,
    // команды, метки и тегов в строке нет — они в «Карточке клиента».
    {
      key: "main",
      title: "Главное",
      keys: [
        "clients",
        "clients.scope",
        "clients.create",
        "clients.menu",
        "clients.delete",
      ],
    },
    // Блоки, которые есть только на странице клиента.
    { key: "card", title: "Карточка клиента", keys: CLIENT_CARD_ROW_ORDER },
    // НАСТРОЙКИ КЛИЕНТОВ — по строке на каждую строку шестерёнки клиентов,
    // как «Настройки команды» у календаря.
    {
      key: "settings",
      title: "Настройки клиентов",
      // В порядке строк шестерёнки клиентов: «Клиент» — блоки и
      // связь, «Объекты» — типы и карты, «Справочники» — теги и источники.
      keys: [
        "clients.settings_card",
        "clients.settings_ways",
        "clients.settings_objects",
        "clients.settings_maps",
        "clients.settings_tags",
        "clients.settings_sources",
      ],
    },
  ],
  // «ФИНАНСЫ» — БЛОКАМИ, КАК «КЛИЕНТЫ»: «Главное» — плитки
  // страницы по порядку, «Настройки финансов» — строки её шестерёнки.
  finance: [
    { key: "main", title: "Главное", keys: FINANCE_ROW_ORDER },
    ...FINANCE_SETTINGS_BLOCKS,
  ],
  calendar: [
    // «Доходы» и «Расходы» здесь нет: они в «Финансах» по плиткам страницы.
    // «ГЛАВНОЕ» — ОДНИМ БЛОКОМ (без отдельного блока «Записи»): метка дня, записи клиентов, их ограничения,
    // записи событий, перенос и отмена.
    {
      key: "main",
      title: "Главное",
      keys: ["calendar.day_labels", ...RECORD_KINDS],
    },
    // БЛОКИ ВНУТРИ ЗАПИСИ И СОБЫТИЯ — ЗДЕСЬ ЖЕ, ПОД «ЗАПИСЯМИ». Скрыты
    // «Записи клиентов» — блока «Запись клиента» нет; скрыты «Записи
    // событий» — нет блока «Событие» (`DEPENDANT_BLOCKS`).
    { key: "record", title: "Запись клиента", keys: RECORD_ROW_ORDER },
    { key: "event", title: "Событие", keys: EVENT_ROW_ORDER },
    // НАСТРОЙКИ КОМАНДЫ — по строке на каждую функцию шестерёнки календаря
    // (может менять часовой пояс, не может график — все функции настроек).
    // Строка
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
