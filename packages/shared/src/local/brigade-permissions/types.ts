// The per-brigade per-master permission matrix shape.

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
