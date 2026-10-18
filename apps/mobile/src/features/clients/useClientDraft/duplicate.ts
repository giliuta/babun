import { useCallback, useEffect, useRef, useState } from "react";
import type { Client } from "@babun/shared/local/clients";
import { findClientByPhoneE164 } from "@babun/shared/db/repositories/clients";
import { listClients as listClientsCached } from "@babun/shared/sync/clientsCached";
import type { ClientsCompanyKind } from "@/session/clients-company";
import { tryToE164 } from "@/lib/phone";

/** Database client the draft writes through (own or a bound tenant). */
type DraftDb = Parameters<typeof findClientByPhoneE164>[0];

/** Phone dedupe of the draft: a debounced lookup of the typed number. */
export function useDraftDuplicate({
  active,
  e164,
  tenantId,
  scopeKind,
  draftClient,
}: {
  active: boolean;
  e164: string | null;
  tenantId: string | null;
  scopeKind: ClientsCompanyKind | undefined;
  draftClient: DraftDb;
}) {
  const [duplicate, setDuplicate] = useState<Client | null>(null);

  /** Поиск клиента по каноническому номеру. Сеть — авторитет, но при её
   *  отказе ищем в ОФЛАЙН-КЭШЕ: правило «телефон уникален» не
   *  должно отключаться вместе с сетью, когда весь список лежит в SQLite.
   *  Тот же приём уже применён на экране чата. */
  const findDuplicate = useCallback(async (key: string): Promise<Client | null> => {
    if (!tenantId) return null;
    const sameNumber = (list: readonly Client[]) =>
      list.find((c) => (c.phone_e164 ?? tryToE164(c.phone ?? "")) === key) ?? null;
    // В компании, где человек работает, номеров в его окне нет никогда (номер
    // — по одному, дверью): искать дубль нечем, а качать ради этого
    // весь список — лишний трафик. Арбитр — UNIQUE-индекс базы: его отказ
    // говорит нейтрально «уже есть у компании» (ниже, `isPhoneTakenError`).
    if (scopeKind === "member") return null;
    try {
      return (await findClientByPhoneE164(draftClient, key, tenantId)) ?? null;
    } catch {
      try {
        const cached = await listClientsCached(draftClient, tenantId);
        return sameNumber(cached);
      } catch {
        // Ни сети, ни кэша — создать разрешаем, финальный арбитр всё равно
        // UNIQUE-индекс в базе (23505 обрабатывается ниже).
        return null;
      }
    }
  }, [tenantId, scopeKind, draftClient]);

  const sequence = useRef(0);
  // Номер, для которого фоновая проверка уже ответила. Повторять её перед записью для того
  // же номера — лишняя поездка в сеть; арбитр всё равно UNIQUE-индекс базы.
  const checkedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!active) return;
    const currentSequence = ++sequence.current;
    if (!e164 || !tenantId) {
      setDuplicate(null);
      return;
    }
    const timer = setTimeout(async () => {
      const existing = await findDuplicate(e164);
      if (sequence.current === currentSequence) {
        setDuplicate(existing);
        checkedFor.current = e164;
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [active, e164, tenantId, findDuplicate]);

  return { duplicate, setDuplicate, findDuplicate, checkedFor };
}
