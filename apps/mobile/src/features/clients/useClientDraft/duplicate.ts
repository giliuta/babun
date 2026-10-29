import { useCallback, useEffect, useRef, useState } from "react";
import type { Client } from "@babun/shared/local/clients";
import { findClientByPhoneE164 } from "@babun/shared/db/repositories/clients";
import { listClients as listClientsCached } from "@babun/shared/sync/clientsCached";
import { findMemberClientByPhone } from "@/features/clients/queries/member-reads";
import type { ClientsCompanyKind } from "@/session/clients-company";
import { tryToE164 } from "@/lib/phone";
import { phoneTail } from "@/features/clients/merge-clients";

/** Database client the draft writes through (own or a bound tenant). */
type DraftDb = Parameters<typeof findClientByPhoneE164>[0];

/** Чей доп. номер совпадает с номером черновика (`phones[].number`) — по
 *  хвосту в 8 цифр, как у слияния; удалённые не в счёт. */
export function extraNumberOwner(list: readonly Client[], e164: string): Client | null {
  const tail = phoneTail(e164);
  if (tail.length < 8) return null;
  return (
    list.find(
      (c) => !c.deleted_at && (c.phones ?? []).some((p) => phoneTail(p.number) === tail),
    ) ?? null
  );
}

/** Phone dedupe of the draft: a debounced lookup of the typed number. */
export function useDraftDuplicate({
  active,
  e164,
  tenantId,
  scopeKind,
  draftClient,
  bookingTeam,
  selfId,
}: {
  /** id, под которым черновик ляжет в базу: сам себе он не дубль. */
  selfId: string;
  active: boolean;
  e164: string | null;
  tenantId: string | null;
  scopeKind: ClientsCompanyKind | undefined;
  draftClient: DraftDb;
  /** Команда записи, ради которой заводят клиента; `null` — не из записи. */
  bookingTeam: string | null;
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
    // ПАРТНЁР, КОТОРЫЙ ЗАВОДИТ КЛИЕНТА ДЛЯ ЗАПИСИ: номер уникален во всей
    // компании, а его окно — часть базы. Клиента с этим номером отдаёт
    // сервер (`member_find_client_by_phone`, по «Новым записям» команды), и
    // его выбирают в запись вместо отказа базы. Отказ двери — «не нашли»:
    // арбитр всё равно UNIQUE-индекс.
    if (bookingTeam && scopeKind !== "own") {
      try {
        return await findMemberClientByPhone(draftClient, key, bookingTeam);
      } catch {
        return null;
      }
    }
    // Вне записи в компании, где человек работает, дубль не ищется: дверь
    // по номеру называла бы клиентов, которых ему не видно. Арбитр —
    // UNIQUE-индекс базы: его отказ говорит нейтрально «уже есть у компании»
    // (ниже, `isPhoneTakenError`).
    if (scopeKind === "member") return null;
    try {
      const main = await findClientByPhoneE164(draftClient, key, tenantId);
      if (main) return main;
      // ДОП. НОМЕРА — ТОЖЕ ДУБЛЬ: «99 123 456» у Марии вторым номером, и
      // новый клиент с этим номером — тот же человек. Индекс базы их не
      // видит, поэтому сверяем по копии на телефоне тем же хвостом номера,
      // что у слияния (`phoneTail`).
      try {
        return extraNumberOwner(await listClientsCached(draftClient, tenantId), key);
      } catch {
        return null;
      }
    } catch {
      try {
        const cached = await listClientsCached(draftClient, tenantId);
        return sameNumber(cached) ?? extraNumberOwner(cached, key);
      } catch {
        // Ни сети, ни кэша — создать разрешаем, финальный арбитр всё равно
        // UNIQUE-индекс в базе (23505 обрабатывается ниже).
        return null;
      }
    }
  }, [tenantId, scopeKind, draftClient, bookingTeam]);

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
      const found = await findDuplicate(e164);
      // ДУБЛЬ — НЕ ОН САМ. Создание кладёт клиента в базу под id черновика, и
      // запоздалая проверка находила его же: под «Создать» на миг вспыхивало
      // «Номер уже есть — <это же имя>».
      const existing = found && found.id !== selfId ? found : null;
      if (sequence.current === currentSequence) {
        setDuplicate(existing);
        checkedFor.current = e164;
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [active, e164, tenantId, findDuplicate, selfId]);

  return { duplicate, setDuplicate, findDuplicate, checkedFor };
}
