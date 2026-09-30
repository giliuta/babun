import type {
  Client,
  ClientContactsHidden,
  ClientMembership,
  PhoneEntry,
} from "@babun/shared/local/clients";

// НОМЕР КЛИЕНТА СОТРУДНИКУ — ПО ОДНОМУ (владелец 30.09: «чтобы не могли
// украсть наших клиентов, перекинуть в свою базу и выгрузить»; план 015 +
// 014).
//
// Списки сотруднику контактов не несут НИКОГДА: окно сервера отдаёт пустые
// телефоны и `contacts_hidden`. Номер открывается дверью
// `member_client_contacts` по действию человека — тапом по звонку, — и
// каждое открытие ложится в журнал с дневным лимитом. Здесь — разбор ответа
// двери и склейка открытого номера с карточкой; чистое, под тестом.

/** Контакты, которые дверь отдаёт открытыми. */
export type MemberContacts = Pick<
  Client,
  | "phone"
  | "whatsapp_phone"
  | "email"
  | "telegram_username"
  | "instagram_username"
  | "phones"
  | "phone_e164"
  | "memberships"
>;

/** Ответ двери. Отказ — ответом, не ошибкой: строка журнала не откатывается. */
export type MemberContactsAnswer =
  | { status: "open"; contacts: MemberContacts }
  | { status: "day" | "right" | "limit" };

/** `contacts_hidden` строки окна. Нет ключа — строка владельца (`undefined`):
 *  прежнее поведение, дверь не зовётся. */
export function contactsHiddenOf(row: object): ClientContactsHidden | undefined {
  if (!("contacts_hidden" in row)) return undefined;
  const value = (row as { contacts_hidden?: unknown }).contacts_hidden;
  return value === "day" || value === "right" ? value : null;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const list = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];

/** Разбор ответа двери. Незнакомый ответ — ошибка: молча показать «номера
 *  нет» хуже, чем сказать, что сервер ответил не то. */
export function parseMemberContacts(raw: unknown): MemberContactsAnswer {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const status = row.status;
  if (status === "day" || status === "right" || status === "limit") return { status };
  if (status !== "open") throw new Error("Сервер вернул незнакомый ответ о номере");
  const phones: PhoneEntry[] = list(row.phones).map((p) => ({
    id: str(p.id),
    number: str(p.number),
    label: str(p.label),
    name: str(p.name),
  }));
  const memberships: ClientMembership[] = list(row.memberships).map((m) => ({
    group_id: str(m.group_id),
    role: str(m.role),
    location_id: typeof m.location_id === "string" ? m.location_id : null,
  }));
  return {
    status: "open",
    contacts: {
      phone: str(row.phone),
      whatsapp_phone: str(row.whatsapp_phone),
      email: str(row.email),
      telegram_username: str(row.telegram_username),
      instagram_username: str(row.instagram_username),
      phones,
      phone_e164: typeof row.phone_e164 === "string" ? row.phone_e164 : null,
      memberships,
    },
  };
}

/** Номер закрыт: строка сотрудника, и открытых контактов в ней нет. */
export function contactsLocked(client: Pick<Client, "contacts_hidden" | "phone">): boolean {
  return client.contacts_hidden !== undefined && !client.phone.trim();
}

/** Карточка с открытыми контактами поверх строки окна. */
export function withContacts<T extends Client>(client: T, contacts: MemberContacts): T {
  return { ...client, ...contacts, contacts_hidden: null };
}
