// Ready-made matrices: full access and read-only.

import type { BrigadeMemberPermissions } from "./types";

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
