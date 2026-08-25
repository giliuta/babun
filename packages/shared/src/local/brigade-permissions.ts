// Sprint 033 Phase I47 — Per-brigade per-master permission matrix.
//
// Each BrigadeMember carries its own copy of this structure so the
// same master can have different reach in different brigades (SaaS
// use case: «Дима — диспетчер в Y&D, но у D&K только читает»). The
// flags here narrow-scope: they apply ONLY inside a brigade's
// calendar / records. They do NOT replace master.role — the role
// still owns global-level perms (see /masters/[id]/access).

export interface BrigadeMemberPermissions {
  // ── КАЛЕНДАРЬ ──────────────────────────────────────────────────
  /** Master sees the brigade's calendar at all. When false, this
   *  brigade's tab is hidden for this master. Default ON — being
   *  added to a brigade implies you can see it. */
  calendar_visible: boolean;
  can_create_record: boolean;
  can_create_event: boolean;

  // ── БЛОК «КЛИЕНТ» ──────────────────────────────────────────────
  client_visible: boolean;
  client_see_name: boolean;
  client_see_phone: boolean;
  client_see_address: boolean;
  client_see_messengers: boolean; // WA / Tg / email
  client_see_history: boolean; // оплаты + баланс
  client_see_other_visits: boolean;
  client_see_tags_notes: boolean;
  client_call_phone: boolean;
  client_send_sms: boolean;
  client_edit: boolean;
  client_edit_address: boolean; // адрес визита, привязан к клиенту
  client_swap: boolean; // сменить клиента в записи
  client_create_new: boolean;

  // ── БЛОК «УСЛУГИ» ──────────────────────────────────────────────
  services_visible: boolean;
  services_see_prices: boolean;
  services_edit_list: boolean;
  services_change_qty: boolean;
  services_discount: boolean;

  // ── ВРЕМЯ И ДАТА ───────────────────────────────────────────────
  time_see: boolean;
  time_change: boolean;
  time_reschedule: boolean;
  time_resize: boolean;

  // ── СТАТУС ВИЗИТА ──────────────────────────────────────────────
  status_in_progress: boolean;
  status_complete: boolean;
  status_no_show: boolean;
  status_cancel: boolean;
  status_reopen: boolean;

  // ── ФИНАНСЫ В ЗАПИСИ ───────────────────────────────────────────
  finance_see_total: boolean;
  finance_change_total: boolean;
  finance_apply_discount: boolean;
  finance_record_payment: boolean;
  finance_see_prepaid: boolean;

  // ── КОММЕНТАРИЙ И ЗАМЕТКА ──────────────────────────────────────
  comment_see: boolean;
  comment_edit: boolean;

  // ── ФОТО ───────────────────────────────────────────────────────
  photos_see: boolean;
  photos_upload: boolean;
  photos_delete: boolean;

  // ── РАСХОДЫ ────────────────────────────────────────────────────
  expenses_see: boolean;
  expenses_edit: boolean;

  // ── НАПОМИНАНИЕ SMS ────────────────────────────────────────────
  reminder_see: boolean;
  reminder_edit: boolean;

  // ── МЕТКА ДНЯ ──────────────────────────────────────────────────
  label_see: boolean;
  label_change: boolean;
  label_create: boolean;

  // ── ФИНАНСЫ БРИГАДЫ (АГРЕГАЦИЯ) ────────────────────────────────
  brigade_finance_revenue: boolean;
  brigade_finance_expenses: boolean;
  brigade_finance_profit: boolean;
  brigade_own_salary: boolean;
}

export type BrigadePermissionKey = keyof BrigadeMemberPermissions;

/** Full-access preset — default for a freshly added member.
 *  Reasoning: adding someone to a brigade implies trust; start
 *  permissive and let admin narrow down if needed. */
export const DEFAULT_BRIGADE_MEMBER_PERMISSIONS: BrigadeMemberPermissions = {
  calendar_visible: true,
  can_create_record: true,
  can_create_event: true,

  client_visible: true,
  client_see_name: true,
  client_see_phone: true,
  client_see_address: true,
  client_see_messengers: true,
  client_see_history: true,
  client_see_other_visits: true,
  client_see_tags_notes: true,
  client_call_phone: true,
  client_send_sms: true,
  client_edit: true,
  client_edit_address: true,
  client_swap: true,
  client_create_new: true,

  services_visible: true,
  services_see_prices: true,
  services_edit_list: true,
  services_change_qty: true,
  services_discount: true,

  time_see: true,
  time_change: true,
  time_reschedule: true,
  time_resize: true,

  status_in_progress: true,
  status_complete: true,
  status_no_show: true,
  status_cancel: true,
  status_reopen: true,

  finance_see_total: true,
  finance_change_total: true,
  finance_apply_discount: true,
  finance_record_payment: true,
  finance_see_prepaid: true,

  comment_see: true,
  comment_edit: true,

  photos_see: true,
  photos_upload: true,
  photos_delete: true,

  expenses_see: true,
  expenses_edit: true,

  reminder_see: true,
  reminder_edit: true,

  label_see: true,
  label_change: true,
  label_create: true,

  brigade_finance_revenue: true,
  brigade_finance_expenses: true,
  brigade_finance_profit: true,
  brigade_own_salary: true,
};

/** Read-only preset — all «видит / visible» flags ON, everything
 *  that mutates state OFF. Useful for temp staff / helpers who just
 *  look at schedule. */
export const READ_ONLY_BRIGADE_MEMBER_PERMISSIONS: BrigadeMemberPermissions = {
  calendar_visible: true,
  can_create_record: false,
  can_create_event: false,

  client_visible: true,
  client_see_name: true,
  client_see_phone: true,
  client_see_address: true,
  client_see_messengers: true,
  client_see_history: true,
  client_see_other_visits: true,
  client_see_tags_notes: true,
  client_call_phone: false,
  client_send_sms: false,
  client_edit: false,
  client_edit_address: false,
  client_swap: false,
  client_create_new: false,

  services_visible: true,
  services_see_prices: true,
  services_edit_list: false,
  services_change_qty: false,
  services_discount: false,

  time_see: true,
  time_change: false,
  time_reschedule: false,
  time_resize: false,

  status_in_progress: false,
  status_complete: false,
  status_no_show: false,
  status_cancel: false,
  status_reopen: false,

  finance_see_total: true,
  finance_change_total: false,
  finance_apply_discount: false,
  finance_record_payment: false,
  finance_see_prepaid: true,

  comment_see: true,
  comment_edit: false,

  photos_see: true,
  photos_upload: false,
  photos_delete: false,

  expenses_see: true,
  expenses_edit: false,

  reminder_see: true,
  reminder_edit: false,

  label_see: true,
  label_change: false,
  label_create: false,

  brigade_finance_revenue: true,
  brigade_finance_expenses: true,
  brigade_finance_profit: true,
  brigade_own_salary: true,
};

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

// ─── Helpers ───────────────────────────────────────────────────────

/** Returns the resolved permissions for a member. Undefined on the
 *  record means «not yet configured» → full access (backward compat). */
export function resolveMemberPermissions(
  p: BrigadeMemberPermissions | undefined,
): BrigadeMemberPermissions {
  if (!p) return DEFAULT_BRIGADE_MEMBER_PERMISSIONS;
  // Fill in any keys missing from saved data (future field additions).
  return { ...DEFAULT_BRIGADE_MEMBER_PERMISSIONS, ...p };
}

/** Counts how many flags are enabled in a matrix — used for preview
 *  labels like «42 из 50 разрешено». */
export function countEnabled(p: BrigadeMemberPermissions): {
  on: number;
  total: number;
} {
  const values = Object.values(p);
  const on = values.filter(Boolean).length;
  return { on, total: values.length };
}
