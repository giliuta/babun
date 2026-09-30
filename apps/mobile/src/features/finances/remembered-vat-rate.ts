import { useCallback, useState } from "react";
import { getStorage } from "@babun/shared/storage";
import { useTenantId } from "@/lib/tenant";

// СТАВКА VAT, КОТОРУЮ ЧЕЛОВЕК НАПИСАЛ ПОСЛЕДНЕЙ.
//
// Владелец 2026-09-22: «когда я нажимаю VAT, изначально там пишется ноль;
// после этого я пишу свою ставку, допустим пять, — и оно запомнилось на
// будущее; если я потом изменил на 19 — запоминает уже её». Одна память на
// все документы компании — инвойс, чек, запись: одна и та же фирма не
// выставляет каждый документ по своей ставке.
//
// Живёт на устройстве, по компании: у двух компаний в одном приложении ставки
// разные. Выставленный документ хранит СВОЮ ставку снимком — память влияет
// только на новые.

export const vatRateKey = (tenantId: string | null) => `vat.lastRate.${tenantId ?? "none"}`;

/** Написанная ставка либо `null`, если на этом телефоне её ещё не писали. */
function readStoredVatRate(tenantId: string | null): number | null {
  const value = getStorage().get<number>(vatRateKey(tenantId));
  return typeof value === "number" && value >= 0 && value < 100 ? value : null;
}

/** НЕ НАПИСАНА — СТАВКА КОМАНДЫ (аудит 2026-09-30). На новом телефоне
 *  память пуста, и команда с 19 % в настройках выставляла инвойс по 0 %:
 *  два телефона — два разных умолчания. Написанная рукой по-прежнему главнее. */
export function readRememberedVatRate(tenantId: string | null, fallback = 0): number {
  return readStoredVatRate(tenantId) ?? fallback;
}

/** Ставка по умолчанию для нового документа и способ её запомнить.
 *  `fallback` — ставка команды из настроек, пока своей не писали. */
export function useRememberedVatRate(fallback = 0): {
  rate: number;
  remember: (rate: number) => void;
} {
  const tenantId = useTenantId();
  const [stored, setStored] = useState(() => readStoredVatRate(tenantId));
  const remember = useCallback(
    (next: number) => {
      setStored(next);
      getStorage().set(vatRateKey(tenantId), next);
    },
    [tenantId],
  );
  return { rate: stored ?? fallback, remember };
}
