import { rowToClient } from "@babun/shared/db/repositories/clients";
import type { Client } from "@babun/shared/local/clients";
import { supabase } from "@/lib/supabase";
import { masterClientJsonToClient } from "@/features/settings/master-reference";
import { parseClientBlocks } from "@/features/clients/client-block-access";
import {
  contactsHiddenOf,
  parseMemberContacts,
  type MemberContactsAnswer,
} from "@/session/member-contacts";

/** Клиент — параметром: прогрев чужой компании зовёт ту же функцию клиентом,
 *  привязанным к ней (`bind-tenant.ts`). */
export async function listMasterClientsSafe(
  client: typeof supabase,
  clientId?: string,
): Promise<Client[]> {
  const { data, error } = await client.rpc("list_master_clients_safe", {
    ...(clientId ? { p_client_id: clientId } : {}),
  });
  if (error) throw new Error(`listMasterClientsSafe: ${error.message}`);
  return (data ?? []).map(masterClientJsonToClient);
}

/** Ответ окна — строка клиента в JSON плюс `tag_ids`: разбирается тем же
 *  маппером, что прямое чтение, значит на экране тот же домен. Его же зовёт
 *  чтение людей карточки (`use-client-links.ts`): `list_client_members` —
 *  такое же окно, и второй разборщик разошёлся бы с этим на первом же поле. */
export function memberClientJsonToClient(row: unknown): Client {
  const record = row as Parameters<typeof rowToClient>[0] & { tag_ids?: unknown };
  // Почему номера нет: у строки сотрудника ключ есть всегда, у
  // владельца его нет — и карточка ведёт себя по-прежнему.
  const hidden = contactsHiddenOf(record);
  // Права по блокам карточки: нет ключа — владелец.
  const blocks = parseClientBlocks((record as { blocks?: unknown }).blocks);
  return {
    ...rowToClient(record),
    tag_ids: Array.isArray(record.tag_ids)
      ? record.tag_ids.filter((id): id is string => typeof id === "string")
      : [],
    ...(hidden !== undefined ? { contacts_hidden: hidden } : {}),
    ...(blocks ? { blocks } : {}),
  };
}

/** НОМЕР ОДНОГО КЛИЕНТА — ДВЕРЬЮ. Пишет в журнал и
 *  тратит дневной лимит: звать только по действию человека (тап по
 *  звонку), не при открытии карточки, и не класть в офлайн-очередь. Отказ
 *  — ответом (`day` / `right` / `limit`), ошибка — только «клиента нет в
 *  наборе» и «не член компании». */
export async function memberClientContacts(
  client: typeof supabase,
  clientId: string,
): Promise<MemberContactsAnswer> {
  const { data, error } = await client.rpc("member_client_contacts", { p_client: clientId });
  if (error) throw new Error(`memberClientContacts: ${error.message}`);
  return parseMemberContacts(data);
}

/** Окно сотрудника плюс клиенты его записей, без дублей: строка окна
 *  главнее (у неё блоки и контакты по правам). Отказ второй двери не роняет
 *  первую. */
export async function withRecordClients(
  member: Promise<Client[]>,
  records: Promise<Client[]>,
): Promise<Client[]> {
  const [own, extra] = await Promise.all([member, records.catch(() => [] as Client[])]);
  const seen = new Set(own.map((c) => c.id));
  return [...own, ...extra.filter((c) => !seen.has(c.id))];
}

/** КЛИЕНТЫ КОМПАНИИ-РАБОТОДАТЕЛЯ — ТОЛЬКО ОКНОМ СЕРВЕРА.
 *
 *  Таблица сотруднику закрыта: её строка несёт телефоны и деньги клиента, а
 *  колонку правилом не спрячешь. Окно `list_member_clients` отдаёт ровно то,
 *  что ему открыли уровнями «Клиенты», «Какие клиенты» и «Телефоны». SQLite
 *  здесь не при чём: чужая база на диск не ложится и в очередь не встаёт. */
export async function listMemberClients(
  client: typeof supabase,
  clientId?: string,
): Promise<Client[]> {
  const { data, error } = await client.rpc(
    "list_member_clients",
    clientId ? { p_client_id: clientId } : undefined,
  );
  if (error) throw new Error(`listMemberClients: ${error.message}`);
  return (data ?? []).map(memberClientJsonToClient);
}
