import { useMemo, useSyncExternalStore } from "react";
import type { Client } from "@babun/shared/local/clients";
import { contactsAfterPatch, withContacts, type MemberContacts } from "./member-contacts";

// ОТКРЫТЫЕ НОМЕРА — ТОЛЬКО В ПАМЯТИ.
//
// Номер, открытый дверью `member_client_contacts`, не ложится ни в кэш
// запросов, ни в MMKV, ни в SQLite: следующая перечитка окна его всё равно
// сотрёт (списки контактов не несут), а на диске он пережил бы и снятие
// права. Живёт до закрытия приложения и не дольше 12 часов — столько сервер
// держит окно правки контактов после открытия (дальше дверь зовут снова).

const TTL_MS = 12 * 60 * 60 * 1000;

type Entry = { contacts: MemberContacts; at: number };
const store = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;

const keyOf = (tenantId: string, clientId: string) => `${tenantId}:${clientId}`;
const emit = () => {
  version += 1;
  for (const l of listeners) l();
};

export function rememberContacts(tenantId: string, clientId: string, contacts: MemberContacts): void {
  store.set(keyOf(tenantId, clientId), { contacts, at: Date.now() });
  emit();
}

/** Удачная правка контактов открытого клиента — обновить снимок полями
 *  патча, чтобы он не затирал свежую строку старыми номерами. */
export function refreshRevealedContacts(
  tenantId: string | null,
  clientId: string,
  patch: Partial<Client>,
): void {
  if (!tenantId) return;
  const entry = store.get(keyOf(tenantId, clientId));
  if (!entry) return;
  store.set(keyOf(tenantId, clientId), { ...entry, contacts: contactsAfterPatch(entry.contacts, patch) });
  emit();
}

/** Снятие права, выход, смена компании — забыть всё открытое. */
export function forgetRevealedContacts(): void {
  if (store.size === 0) return;
  store.clear();
  emit();
}

function revealed(tenantId: string | null, clientId: string | null | undefined): MemberContacts | null {
  if (!tenantId || !clientId) return null;
  const entry = store.get(keyOf(tenantId, clientId));
  if (!entry) return null;
  if (Date.now() - entry.at > TTL_MS) {
    store.delete(keyOf(tenantId, clientId));
    return null;
  }
  return entry.contacts;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Карточка с открытым номером поверх строки окна, если его открывали. */
export function useRevealedClient<T extends Client>(
  client: T | null | undefined,
  tenantId: string | null,
): T | null | undefined {
  const v = useSyncExternalStore(subscribe, () => version);
  return useMemo(() => {
    if (!client || client.contacts_hidden === undefined) return client;
    const contacts = revealed(tenantId, client.id);
    return contacts ? withContacts(client, contacts) : client;
    // `v` — версия хранилища: новая открытая пара перерисовывает карточку.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, tenantId, v]);
}
