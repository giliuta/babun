import { useEffect, useRef } from "react";
import type { Client } from "@babun/shared/local/clients";
import { getStorage } from "@babun/shared/storage";

/** Ключ снимка нового клиента — свой у каждой компании и команды, из чипа
 *  которой его открыли. */
export const storedDraftKey = (tenantId: string, team: string | null | undefined) =>
  `babun:clients:new-draft:${tenantId}${team ? `:${team}` : ""}`;

/** НОВЫЙ КЛИЕНТ ПЕРЕЖИВАЕТ ВЫГРУЗКУ ПРИЛОЖЕНИЯ.
 *
 *  «Назад» с набранным спрашивает «Удалить черновик?», но iOS выгружает
 *  приложение из фона молча — и имя, номер, заметка пропадали. Набранный
 *  черновик лежит снимком в памяти телефона и поднимается при следующем
 *  «Создать клиента». Снимается после создания и после «Удалить черновик».
 *
 *  Только у обычного нового клиента: черновик из записи, связи или
 *  «Разделить» несёт контекст своего экрана, и поднимать его в другом месте
 *  нельзя (`key` тогда `null`). */
export function useStoredClientDraft({
  key,
  draft,
  dirty,
  hasInput,
  restore,
}: {
  key: string | null;
  draft: Client;
  dirty: boolean;
  /** Набрано ли что-то в черновике прямо сейчас (не затирать набранное). */
  hasInput: () => boolean;
  restore: (stored: Client) => void;
}) {
  const restored = useRef(false);
  const done = useRef(false);
  const latest = useRef({ hasInput, restore });
  latest.current = { hasInput, restore };

  // Подъём — один раз, как только известна компания (до неё ключа нет).
  useEffect(() => {
    if (!key || restored.current) return;
    restored.current = true;
    const stored = getStorage().get<Client>(key);
    if (stored && !latest.current.hasInput()) latest.current.restore(stored);
  }, [key]);

  // Снимок на каждое изменение: запись синхронная и дешёвая.
  useEffect(() => {
    if (!key || done.current) return;
    if (dirty) getStorage().set(key, draft);
    else getStorage().remove(key);
  }, [key, draft, dirty]);

  /** Черновик больше не нужен: клиент создан или черновик удалён. */
  return () => {
    done.current = true;
    if (key) getStorage().remove(key);
  };
}
