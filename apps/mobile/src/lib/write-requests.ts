// КАКОЙ ЗАПРОС ПИШЕТ — СПРОШЕНО У БАЗЫ, А НЕ УГАДАНО ПО ИМЕНИ.
//
// Режим «Посмотреть его глазами» (STORY-083) показывает владельцу настоящие
// экраны с правами сотрудника, а запросы всё это время уходят ЕГО токеном.
// Значит на время просмотра запись запрещена целиком — и кто-то должен
// отличать чтение от записи ДО отправки.
//
// Метод HTTP отвечает на это лишь наполовину: PostgREST зовёт функции через
// POST, и `my_access_map` внешне неотличим от `issue_receipt`. Поэтому
// функции разобраны поимённо, и разобраны не на глаз: у боевой базы
// 20.09 спрошена объявленная ВОЛАТИЛЬНОСТЬ каждой из вызываемых функций
// (`pg_proc.provolatile`). `stable` — чтение, `volatile` — запись. Так
// список опирается на свойство самой функции, а не на догадку по приставке
// (`write_sms_templates_safe` тоже кончается на `_safe`, а пишет).
//
// НЕИЗВЕСТНОЕ ИМЯ СЧИТАЕТСЯ ЗАПИСЬЮ. Новая функция, о которой этот файл не
// знает, в просмотре будет отбита: в худшем случае экран покажет ошибку, а
// не тихо создаст данные в чужой компании. Сторож в тесте следит, чтобы
// каждая вызываемая приложением функция была здесь названа.

/** Функции, которые только читают: `provolatile = 's'` на 20.09.2026. */
export const READ_RPCS: ReadonlySet<string> = new Set([
  "account_balances",
  "appointment_link_lookup",
  "current_tenant_profile_safe",
  "current_user_role",
  "invitation_preview",
  // STORY-086: `stable` объявлено в `20260922010000_client_members_read.sql`;
  // в боевой базе её ещё нет — сверить `provolatile` после наката.
  "list_client_members",
  "list_dispatcher_services_safe",
  "list_master_appointments_safe",
  "list_master_clients_safe",
  "list_master_services_safe",
  "list_member_access",
  "list_member_clients",
  // «История записей» клиента сотруднику (015, 01.10): `stable`.
  "member_client_history",
  "list_members",
  "list_my_calendars",
  "list_operational_masters_safe",
  "list_operational_teams_safe",
  "list_payment_accounts_safe",
  "location_request_lookup",
  "my_access_map",
  "my_invitations",
  // STORY-101: предпросмотр номера из серии юрлица, `stable`
  // (миграция 20261001001000).
  "peek_document_number",
  "read_operational_calendar_settings_safe",
  "read_sms_templates_safe",
  "sms_account",
  "sms_for_appointment",
  "sms_for_client",
  "sms_history",
  "sms_team_templates",
  "tenant_quota_appointments_month",
  "tenant_quota_clients",
  // Рабочий день компании — окно «Около записи» в зеркале (015, 30.09):
  // `provolatile = 's'` спрошено у базы 30.09.
  "tenant_business_date",
]);

/** Функции, которые пишут: `provolatile = 'v'`. Перечислены явно, хотя
 *  неизвестное имя и так считается записью — список держит сторож в тесте и
 *  показывает человеку, что именно в просмотре недоступно. */
export const WRITE_RPCS: ReadonlySet<string> = new Set([
  "accept_invitation",
  "accept_invitation_by_id",
  "activate_tenant",
  "apply_location_label_changes",
  "apply_team_location_label_changes",
  "appointment_link_answer",
  "cancel_appointment_payment",
  "cancel_invoice",
  // Тарифы (миграция 20261001183700, 015): рабочие команды и пробный период.
  "choose_working_teams",
  "create_client_with_tags",
  // Первый календарь владельца — заводит только при пустой компании (03.10).
  "create_first_calendar",
  "create_invitation",
  "decline_invitation",
  "delete_account_transfer",
  "delete_calendar",
  "delete_invoice",
  // «Удалённые операции» (миграция 20261003224700, 016).
  "delete_operation",
  "issue_invoice",
  "issue_receipt",
  "update_receipt",
  "location_request_create",
  "location_request_submit",
  "member_appointment_copy",
  "member_appointment_create",
  "member_appointment_delete",
  "member_appointment_update",
  // Открытие номера пишет журнал и тратит лимит (миграция
  // 20260930233000_clients_contacts_one_by_one, 015): в просмотре — нельзя.
  "member_client_contacts",
  "member_update_team",
  "member_rename_day_label",
  "patch_master_profile",
  "record_account_transfer",
  "record_appointment_payment",
  "record_invoice_payment",
  "refund_invoice_payment",
  "replace_day_extras",
  "reset_appointment_payment",
  "restore_deleted_operation",
  "set_appointment_prepayment",
  "set_client_sms_opt_out",
  "set_client_team",
  "member_trash_client",
  "set_default_company",
  // STORY-101: старт серии документов юрлица (миграция 20261001001000).
  "set_document_series_start",
  "set_member_access",
  "set_member_calendars",
  "sms_appointment_link",
  "sms_autotopup_forget",
  "sms_autotopup_save",
  "sms_delete_team_template",
  "sms_reorder_team_templates",
  "sms_save_settings",
  "sms_save_team_sender",
  "sms_save_team_template",
  "sms_send_bulk",
  "sms_send_manual",
  "sms_set_team_template_enabled",
  "start_trial",
  "undo_appointment_payment",
  "update_client_with_tags",
  "update_invoice_draft",
  "update_master_appointment_safe",
  "void_invoice",
  "write_sms_templates_safe",
]);

const READING_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Путь и параметры запроса. Сверять ПОДСТРОКОЙ по всему адресу нельзя:
 *  бакет с именем `sign` или значение фильтра с той же подстрокой открыли бы
 *  дверь записи. Адрес без схемы (в тестах и шимах) считается путём. */
function partsOf(url: string): { path: string; params: URLSearchParams } {
  try {
    const parsed = new URL(url);
    return { path: parsed.pathname, params: parsed.searchParams };
  } catch {
    const [path = url, query = ""] = url.split("?", 2);
    return { path, params: new URLSearchParams(query) };
  }
}

/** Имя функции из адреса PostgREST, либо `null`, если это не вызов функции. */
function rpcName(path: string): string | null {
  const marker = "/rest/v1/rpc/";
  const at = path.indexOf(marker);
  if (at < 0) return null;
  const name = path.slice(at + marker.length).split("/", 1)[0] ?? "";
  return name || null;
}

/** Пишет ли этот запрос. Чистая функция: её и проверяет тест. */
export function isWriteRequest(method: string, url: string): boolean {
  const verb = method.toUpperCase();
  const { path, params } = partsOf(url);

  // ПРОДЛЕНИЕ СЕССИИ — НЕ ЗАПИСЬ, А ВОТ ВЫДАЧА НОВОЙ — ЗАПИСЬ. Оба идут
  // POST'ом на один адрес и различаются только видом выдачи: обновление
  // токена обязано проходить (иначе просмотр длиной в час кончался бы
  // выходом), а вход по паролю в режиме просмотра — нет.
  if (path === "/auth/v1/token") return params.get("grant_type") !== "refresh_token";

  // ВЫЙТИ МОЖНО ВСЕГДА. Отбитый выход хуже открытого: клиент снимает
  // локальную сессию ДО того, как узнаёт об отказе, и чистка данных компании
  // с устройства (`auth-clear.ts`) уже не выполняется — человек «вышел», а
  // кэш компании, очередь и ключи остались на телефоне.
  if (path === "/auth/v1/logout") return false;

  // ССЫЛКА НА ФАЙЛ — ЧТЕНИЕ, ХОТЬ И POST. Storage выдаёт подписанный адрес
  // картинки методом POST, и без этой строки в зеркале не открывалось бы ни
  // одно фото с объекта. Подпись на ЗАГРУЗКУ (`/object/upload/sign/…`) сюда
  // не попадает: она открывает дверь записи.
  if (path.startsWith("/storage/v1/object/sign/")) return false;

  if (READING_METHODS.has(verb)) return false;

  const name = rpcName(path);
  if (name !== null) return !READ_RPCS.has(name);

  // Всё остальное с не-читающим методом — вставка, правка, удаление строки
  // или загрузка файла.
  return true;
}
