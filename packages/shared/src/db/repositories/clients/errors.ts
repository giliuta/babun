// Server refusals of client writes, in words a person can act on.

type ClientWriteRpcName =
  | "create_client_with_tags"
  | "update_client_with_tags";

type PostgrestErrorLike = {
  code?: string;
  message?: string;
  hint?: string;
  status?: number;
  statusCode?: number;
};

/** Имена блоков карточки — как на странице прав (015 + 014). */
const CLIENT_BLOCK_TITLES: Record<string, string> = {
  "clients.client": "Клиент",
  "clients.note": "Заметка",
  "clients.people": "Люди",
  "clients.objects": "Объекты",
  // «Метка» и «Тег» — два права; «Долг и деньги» ушли в «Историю».
  "clients.labels": "Метка",
  "clients.tags": "Тег",
  "clients.personal": "Личное",
  "clients.files": "Файлы",
  "clients.requisites": "Реквизиты",
  "clients.history": "История",
  "clients.sms": "SMS",
};

/** Права-действия — своей фразой: «менять „Удаление клиента"» не по-русски.
 *  `block:clients` сервер даёт и без базы, и на деньги, корзину и любимого
 *  мастера в правке партнёра — это всегда дело владельца. */
const CLIENT_ACTION_REFUSALS: Record<string, string> = {
  clients: "Это может только владелец",
  "clients.create": "Нет права заводить клиентов",
  "clients.menu": "Нет права на «Меню клиента»",
  "clients.delete": "Нет права удалять клиентов",
};

/** ОТКАЗ СЕРВЕРА СЛОВАМИ. Права по блокам отвечают 42501
 *  с подсказкой `block:clients.note`, закрытый номер — `access:contacts_closed`,
 *  клиент вне набора — P0002. Сырой английский текст Postgres человеку нечего
 *  делать; наше слово — что именно нельзя и что сделать. `null` — не наш
 *  случай, остаётся прежний текст. */
export function clientWriteRefusal(error: PostgrestErrorLike): string | null {
  const hint = error.hint ?? "";
  if (hint === "access:contacts_closed") return "Сначала откройте номер";
  // Партнёр ставит только теги команды клиента.
  if (hint === "client:tag_other_team") return "Тег другой команды этому клиенту не поставить";
  if (hint.startsWith("block:")) {
    const key = hint.slice("block:".length);
    if (CLIENT_ACTION_REFUSALS[key]) return CLIENT_ACTION_REFUSALS[key];
    const title = CLIENT_BLOCK_TITLES[key];
    return title ? `Нет права менять «${title}»` : "Нет права на это изменение";
  }
  if (error.code === "P0002") return "Клиент недоступен";
  return null;
}

/** Rolling deployment compatibility is deliberately narrow. Only a missing
 * RPC/schema-cache contract may use the legacy multi-request path; validation,
 * authorization and database errors must surface unchanged so callers never
 * turn a rejected atomic write into a partial one. */
export function isMissingClientWriteRpc(
  error: PostgrestErrorLike,
  rpcName: ClientWriteRpcName,
): boolean {
  const message = error.message ?? "";
  const namesRequestedRpc = message.toLowerCase().includes(rpcName);
  if (!namesRequestedRpc) return false;
  return (
    error.code === "PGRST202"
    || (
      error.code === "42883"
      && /does not exist|undefined function/i.test(message)
    )
    || /could not find the function|schema cache/i.test(message)
  );
}

export function clientWriteError(
  prefix: string,
  error: PostgrestErrorLike,
): Error {
  const refusal = clientWriteRefusal(error);
  const wrapped = new Error(refusal ?? `${prefix}: ${error.message ?? "unknown error"}`);
  Object.assign(wrapped, {
    code: error.code,
    hint: error.hint,
    status: error.status,
    statusCode: error.statusCode,
  });
  return wrapped;
}

export function atomicClientTagsUnavailable(operation: "create" | "update"): Error {
  const action = operation === "create" ? "создать клиента с тегами" : "изменить теги клиента";
  const error = new Error(
    `Сейчас нельзя безопасно ${action}: серверная схема ещё не обновлена. Остальные данные не изменены.`,
  );
  Object.assign(error, { code: "CLIENT_TAGS_ATOMIC_RPC_REQUIRED" });
  return error;
}
