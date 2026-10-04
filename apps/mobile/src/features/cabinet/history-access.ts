import type { MemberAccessMap } from "@/features/access/access-map";
import type { ChangeLogRow } from "./change-log";

// «ИСТОРИЯ ИЗМЕНЕНИЙ» ПАРТНЁРА — ЧТО ИЗ ЖУРНАЛА ЕМУ ВИДНО (владелец 04.10:
// «также ещё можно добавить историю изменений»).
//
// Право раздела «Кабинет» `cabinet.history` (Скрыта · Видит) открывает журнал
// пригласившего аккаунта, но только по его командам и только в тех разделах,
// что ему открыты в этой команде. Копия политики сервера
// `change_log_select_partner` (миграция 20261004082634): там режет база,
// здесь — режим «Посмотреть его глазами», где токен ваш и журнал приходит
// целиком. Сверку таблицы с миграцией держит `history-access.test.ts`.

export const HISTORY_KEY = "cabinet.history";

/** Таблица журнала → права команды, любое из которых открывает её строки.
 *  Чего здесь нет — права и состав людей, реквизиты, шаблоны SMS, — только
 *  владельцу. */
export const HISTORY_ENTITY_RIGHTS: Readonly<Record<string, readonly string[]>> = {
  appointments: ["calendar.records"],
  appointment_photos: ["record.files"],
  day_cities: ["calendar.day_labels"],
  clients: ["clients"],
  client_attachments: ["clients.files"],
  client_tag_assignments: ["clients.tags"],
  client_tags: ["clients.settings_tags"],
  client_sources: ["clients.settings_sources"],
  finance_transactions: ["finance.income", "finance.expense"],
  finance_categories: [
    "finance.settings_categories_income",
    "finance.settings_categories_expense",
    "finance.settings_categories_debts",
  ],
  debts: ["finance.debts"],
  accounts: ["finance.accounts"],
  invoices: ["finance.documents"],
  receipts: ["finance.documents"],
  services: ["calendar.services"],
  cities: ["calendar.labels"],
  location_labels: ["calendar.labels"],
  team_schedules: ["calendar.schedule"],
  teams: ["calendar.identity"],
  calendar_settings: ["calendar.hours"],
  team_design: ["calendar.booking_form"],
  personal_event_types: ["calendar.booking_form"],
};

const seen = (level: string | undefined) => !!level && level !== "off";

/** Видна ли партнёру строка журнала по его карте прав. Календарь без записей
 *  клиентов карта не несёт вовсе — как и сервер (`access_calendars`). */
export function historyRowVisible(
  row: Pick<ChangeLogRow, "team_id" | "entity">,
  map: MemberAccessMap | undefined,
): boolean {
  if (!map) return false;
  if (map.isOwner) return true;
  if (!seen(map.company[HISTORY_KEY])) return false;
  if (!row.team_id) return false;
  const team = map.calendars[row.team_id];
  if (!team) return false;
  const rights = HISTORY_ENTITY_RIGHTS[row.entity];
  return !!rights && rights.some((key) => seen(team[key]));
}
