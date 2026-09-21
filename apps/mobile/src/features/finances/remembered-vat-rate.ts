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

export function readRememberedVatRate(tenantId: string | null): number {
  const value = getStorage().get<number>(vatRateKey(tenantId));
  return typeof value === "number" && value >= 0 && value < 100 ? value : 0;
}

/** Ставка по умолчанию для нового документа и способ её запомнить. */
export function useRememberedVatRate(): {
  rate: number;
  remember: (rate: number) => void;
} {
  const tenantId = useTenantId();
  const [rate, setRate] = useState(() => readRememberedVatRate(tenantId));
  const remember = useCallback(
    (next: number) => {
      setRate(next);
      getStorage().set(vatRateKey(tenantId), next);
    },
    [tenantId],
  );
  return { rate, remember };
}
