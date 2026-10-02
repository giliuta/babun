// БЛОКИ КАРТОЧКИ КЛИЕНТА ПО ПРАВАМ (владелец 30.09: «страница клиентов по
// правам — полностью, максимум»). Сервер сам решает, что открыто у ЭТОГО
// клиента: строка сотрудника несёт `blocks` — положения по командам, через
// которые клиент ему виден (`access_client_blocks`), и поля закрытых блоков
// приходят пустыми. Экран только читает ответ:
//   • "hidden" — блока на карточке нет вовсе;
//   • "read"   — блок без дверей и правки;
//   • "write"  — как у владельца.
// Строки без `blocks` — владелец (или сервер до наката): всё открыто.

export type ClientCardBlock =
  | "clients"
  | "clients.note"
  | "clients.people"
  | "clients.objects"
  | "clients.labels"
  | "clients.personal"
  | "clients.files"
  | "clients.requisites"
  | "clients.history"
  | "clients.money";

export type ClientBlockLevel = "hidden" | "read" | "write";

/** Положение блока карточки у клиента. */
export function clientBlockLevel(
  client: { blocks?: Readonly<Record<string, string>> | null } | null | undefined,
  key: ClientCardBlock,
): ClientBlockLevel {
  const blocks = client?.blocks;
  if (!blocks) return "write";
  const level = blocks[key];
  if (level === "write") return "write";
  if (level === "read") return "read";
  return "hidden";
}

/** `blocks` из строки сервера — только знакомые положения; чужое — как нет. */
export function parseClientBlocks(raw: unknown): Readonly<Record<string, string>> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === "off" || value === "read" || value === "write") out[key] = value;
  }
  return out;
}
