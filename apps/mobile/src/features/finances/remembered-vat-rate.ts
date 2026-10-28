import { useCallback, useState } from "react";
import { getStorage } from "@babun/shared/storage";
import { useTenantId } from "@/lib/tenant";

// СТАВКА VAT, КОТОРУЮ ЧЕЛОВЕК НАПИСАЛ ПОСЛЕДНЕЙ.
//
// Нажали VAT — изначально там ноль; человек пишет свою ставку, допустим пять, и
// она запоминается на будущее; изменил потом на 19 — запоминается уже она. Одна память на
// все документы компании — инвойс, чек, запись: одна и та же фирма не
// выставляет каждый документ по своей ставке.
//
// Живёт на устройстве, по компании: у двух компаний в одном приложении ставки
// разные. Выставленный документ хранит СВОЮ ставку снимком — память влияет
// только на новые.

// Под `babun:` — его подметает «Выйти» (ключ без
// префикса переживал выход).
const vatRateKey = (tenantId: string | null) => `babun:vat:last-rate:${tenantId ?? "none"}`;

/** Написанная ставка либо `null`, если на этом телефоне её ещё не писали. */
function readStoredVatRate(tenantId: string | null): number | null {
  const value = getStorage().get<number>(vatRateKey(tenantId));
  return typeof value === "number" && value >= 0 && value < 100 ? value : null;
}

/** НЕ НАПИСАНА — СТАВКА КОМАНДЫ. На новом телефоне
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
  // ПАМЯТЬ ЧИТАЕТСЯ НА КАЖДЫЙ ПОКАЗ, А НЕ ОДИН РАЗ.
  // Снимок при монтировании жил весь сеанс: вкладка «Финансы» не видела
  // ставку, только что написанную в «Итого» инвойса, до перезапуска, а после
  // смены компании считала по ставке ПРЕЖНЕЙ. Хранилище синхронное (MMKV) —
  // чтение дешёвое; счётчик лишь перерисовывает после своей записи.
  const [, setWrites] = useState(0);
  const stored = readStoredVatRate(tenantId);
  const remember = useCallback(
    (next: number) => {
      // Негодное число память не портит: читается она только в 0…99.99.
      if (!Number.isFinite(next) || next < 0 || next >= 100) return;
      getStorage().set(vatRateKey(tenantId), next);
      setWrites((n) => n + 1);
    },
    [tenantId],
  );
  return { rate: stored ?? fallback, remember };
}
