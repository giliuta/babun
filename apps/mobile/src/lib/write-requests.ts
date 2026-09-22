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
  "current_tenant_profile_safe",
  "current_user_role",
  "invitation_preview",
  "list_dispatcher_services_safe",
  "list_master_appointments_safe",
  "list_master_clients_safe",
  "list_master_services_safe",
  "list_member_access",
  "list_member_clients",
  "list_members",
  "list_my_calendars",
  "list_operational_masters_safe",
  "list_operational_teams_safe",
  "list_payment_accounts_safe",
  "location_request_lookup",
  "my_access_map",
  "my_invitations",
  "next_company_invoice_number",
  "next_invoice_number",
  "read_operational_calendar_settings_safe",
  "read_sms_templates_safe",
  "tenant_quota_appointments_month",
  "tenant_quota_clients",
]);

/** Функции, которые пишут: `provolatile = 'v'`. Перечислены явно, хотя
 *  неизвестное имя и так считается записью — список держит сторож в тесте и
 *  показывает человеку, что именно в просмотре недоступно. */
export const WRITE_RPCS: ReadonlySet<string> = new Set([
  "accept_invitation",
  "accept_invitation_by_id",
  "activate_tenant",
  "apply_location_label_changes",
  "cancel_appointment_payment",
  "cancel_invoice",
  "create_client_with_tags",
  "create_invitation",
  "decline_invitation",
  "delete_account_transfer",
  "delete_calendar",
  "issue_invoice",
  "issue_receipt",
  "location_request_create",
  "location_request_submit",
  "patch_master_profile",
  "record_account_transfer",
  "record_appointment_payment",
  "record_invoice_payment",
  "refund_invoice_payment",
  "replace_day_extras",
  "reset_appointment_payment",
  "set_appointment_prepayment",
  // Живёт в ещё не накатанной миграции `20260920200000_companies_registry`:
  // волатильность спросить не у кого, а дело её — ставить умолчание.
  "set_company_invoice_next_number",
  "set_default_company",
  "set_member_access",
  "set_member_calendars",
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
