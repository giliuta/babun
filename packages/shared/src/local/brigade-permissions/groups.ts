import type { BrigadePermissionKey } from "./types";

// ─── Group metadata — drives the UI on the access editor page ─────

export interface FlagGroup {
  id: string;
  title: string;
  emoji: string;
  /** When defined and its value is false in the current permissions,
   *  every row with `indent === true` is disabled and greyed. */
  parent?: BrigadePermissionKey;
  rows: FlagRow[];
}

export interface FlagRow {
  key: BrigadePermissionKey;
  label: string;
  description?: string;
  /** Whether this row is a sub-row of the parent. Visually indented
   *  and disabled when parent is OFF. */
  indent?: boolean;
}

export const BRIGADE_PERMISSION_GROUPS: FlagGroup[] = [
  {
    id: "calendar",
    title: "Календарь",
    emoji: "📅",
    parent: "calendar_visible",
    rows: [
      { key: "calendar_visible", label: "Видит календарь команды" },
      {
        key: "can_create_record",
        label: "Создавать записи",
        description: "Тап по пустому слоту открывает форму новой записи.",
        indent: true,
      },
      {
        key: "can_create_event",
        label: "Создавать события",
        description: "Перерывы, личные встречи — не клиентские.",
        indent: true,
      },
    ],
  },
  {
    id: "client",
    title: "Блок «Клиент»",
    emoji: "👤",
    parent: "client_visible",
    rows: [
      { key: "client_visible", label: "Видит блок клиента" },
      { key: "client_see_name", label: "Видит имя", indent: true },
      { key: "client_see_phone", label: "Видит телефон", indent: true },
      { key: "client_see_address", label: "Видит адрес", indent: true },
      {
        key: "client_see_messengers",
        label: "Видит WhatsApp / Telegram / email",
        indent: true,
      },
      {
        key: "client_see_history",
        label: "Видит историю платежей и баланс",
        indent: true,
      },
      {
        key: "client_see_other_visits",
        label: "Видит другие визиты клиента",
        indent: true,
      },
      {
        key: "client_see_tags_notes",
        label: "Видит теги и заметки",
        indent: true,
      },
      {
        key: "client_call_phone",
        label: "Может звонить клиенту",
        description: "Кнопка «📞» в карточке клиента.",
      },
      {
        key: "client_send_sms",
        label: "Может писать клиенту",
        description: "SMS / WhatsApp из карточки.",
      },
      {
        key: "client_edit",
        label: "Редактировать клиента",
        description: "Имя, телефон, мессенджеры.",
      },
      {
        key: "client_edit_address",
        label: "Редактировать адрес визита",
        description: "Адрес, привязанный к конкретной записи.",
      },
      { key: "client_swap", label: "Сменить клиента в записи" },
      { key: "client_create_new", label: "Создавать нового клиента" },
    ],
  },
  {
    id: "services",
    title: "Блок «Услуги»",
    emoji: "🔧",
    parent: "services_visible",
    rows: [
      { key: "services_visible", label: "Видит блок услуг" },
      { key: "services_see_prices", label: "Видит цены", indent: true },
      { key: "services_edit_list", label: "Добавлять / убирать услуги" },
      { key: "services_change_qty", label: "Менять количество" },
      { key: "services_discount", label: "Применять скидку" },
    ],
  },
  {
    id: "time",
    title: "Время и дата",
    emoji: "🕒",
    rows: [
      { key: "time_see", label: "Видит время записи" },
      { key: "time_change", label: "Менять время внутри дня" },
      { key: "time_reschedule", label: "Переносить на другой день" },
      { key: "time_resize", label: "Менять длительность" },
    ],
  },
  {
    id: "status",
    title: "Статус визита",
    emoji: "✅",
    rows: [
      { key: "status_in_progress", label: "Ставить «в работе»" },
      { key: "status_complete", label: "Закрывать визит (выполнен)" },
      { key: "status_no_show", label: "Ставить «клиент не пришёл»" },
      { key: "status_cancel", label: "Отменять визит" },
      {
        key: "status_reopen",
        label: "Возвращать в работу",
        description: "Отменённый или закрытый визит снова в работу.",
      },
    ],
  },
  {
    id: "finance",
    title: "Финансы внутри записи",
    emoji: "💰",
    rows: [
      { key: "finance_see_total", label: "Видит сумму визита" },
      { key: "finance_change_total", label: "Менять сумму вручную" },
      { key: "finance_apply_discount", label: "Применять скидку" },
      {
        key: "finance_record_payment",
        label: "Фиксировать оплату",
        description: "Наличные / карта / раздельно при закрытии визита.",
      },
      { key: "finance_see_prepaid", label: "Видит аванс" },
    ],
  },
  {
    id: "comment",
    title: "Комментарий и заметки",
    emoji: "💬",
    parent: "comment_see",
    rows: [
      {
        key: "comment_see",
        label: "Видит комментарий",
        description: "И заметку к адресу.",
      },
      { key: "comment_edit", label: "Редактирует", indent: true },
    ],
  },
  {
    id: "photos",
    title: "Фото",
    emoji: "📷",
    parent: "photos_see",
    rows: [
      { key: "photos_see", label: "Видит фото (до/после)" },
      { key: "photos_upload", label: "Загружает", indent: true },
      { key: "photos_delete", label: "Удаляет", indent: true },
    ],
  },
  {
    id: "expenses",
    title: "Расходы",
    emoji: "🧾",
    parent: "expenses_see",
    rows: [
      { key: "expenses_see", label: "Видит расходы" },
      {
        key: "expenses_edit",
        label: "Добавлять / удалять строки",
        indent: true,
      },
    ],
  },
  {
    id: "reminder",
    title: "Напоминание клиенту (SMS)",
    emoji: "🔔",
    parent: "reminder_see",
    rows: [
      { key: "reminder_see", label: "Видит шаблон" },
      { key: "reminder_edit", label: "Меняет шаблон и авто-отправку", indent: true },
    ],
  },
  {
    id: "label",
    title: "Метка дня",
    emoji: "🏷",
    parent: "label_see",
    rows: [
      { key: "label_see", label: "Видит метку" },
      { key: "label_change", label: "Менять метку для даты", indent: true },
      { key: "label_create", label: "Создавать новые метки", indent: true },
    ],
  },
  {
    id: "brigade_finance",
    title: "Финансы команды",
    emoji: "📊",
    rows: [
      { key: "brigade_finance_revenue", label: "Видит выручку команды" },
      { key: "brigade_finance_expenses", label: "Видит расходы команды" },
      { key: "brigade_finance_profit", label: "Видит прибыль" },
      { key: "brigade_own_salary", label: "Видит свою ЗП" },
    ],
  },
];
