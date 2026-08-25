// Разбор ошибок создания клиента. Вынесено из useClientDraft, чтобы
// оставаться чистым модулем без expo-router / react-native — иначе тест
// тянет весь граф навигации и не запускается.

/** Нарушение частичного UNIQUE-индекса clients_tenant_phone_e164_idx.
 *
 *  Настоящий арбитр уникальности телефона — индекс в БД, а не проверка
 *  перед записью: две вкладки, два устройства и офлайн-очередь, доехавшая
 *  позже, обходят любую предварительную проверку. Обёртки (offline-queue,
 *  PostgREST) по дороге теряют структуру ошибки, поэтому смотрим и код, и
 *  текст — но требуем упоминания phone_e164, чтобы чужой дубль (например,
 *  по appointments_pkey) не выдавал «телефон занят». */
export function isPhoneTakenError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string; details?: string };
  if (e.code === "23505") return true;
  const text = `${e.message ?? ""} ${e.details ?? ""}`;
  return (
    text.includes("clients_tenant_phone_e164_idx") ||
    (text.includes("duplicate key") && text.includes("phone_e164"))
  );
}

/** Текст ошибки для пользователя.
 *
 *  Владелец увидел на экране «createClient: function
 *  public.normalize_client_tag_ids(uuid, uuid[]) does not exist» — сырую
 *  ошибку Postgres. Такое показывать нельзя: человеку нечего с этим
 *  делать, а выглядит как поломка всего приложения.
 *
 *  Правило простое и честное: наши собственные сообщения (квоты, лимиты,
 *  доступ) написаны по-русски — их показываем как есть. Всё остальное —
 *  латиница из драйвера, PostgREST или самого Postgres — заменяем общей
 *  фразой, а техподробности уводим в консоль, чтобы не потерять их при
 *  отладке. */
export function friendlyCreateError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  console.error("createClient failed:", raw);
  return /[А-Яа-яЁё]/.test(raw)
    ? raw
    : "Не удалось сохранить клиента. Попробуйте ещё раз.";
}
