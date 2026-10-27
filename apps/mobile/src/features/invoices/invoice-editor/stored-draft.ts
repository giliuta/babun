import { useEffect, useRef } from "react";
import type { InvoiceVatMode } from "@babun/shared/local/finance/invoice-ledger";
import { getStorage } from "@babun/shared/storage";
import type { DiscountKind } from "@/features/appointments/TotalSheet";
import type { InvoiceLanguage } from "@/lib/paper/dictionary";
import type { EditableInvoiceLine } from "@/lib/paper/format";

/** Ключ снимка нового инвойса — свой у каждой компании и команды, из чипа
 *  которой его открыли. */
export const storedInvoiceDraftKey = (tenantId: string, team: string | null | undefined) =>
  `babun:invoices:new-draft:${tenantId}${team ? `:${team}` : ""}`;

/** Что набрал человек. Даты не храним: нетронутые едут за часами бизнеса, и
 *  поднятый завтра черновик со вчерашней датой выставился бы задним числом.
 *  У строк нет `id` — его раздаёт форма, поднявшая снимок. */
export interface StoredInvoiceDraft {
  language: InvoiceLanguage;
  clientId: string | null;
  locationId: string | null;
  clientRequisitesId: string | null;
  teamId: string | null;
  vatMode: InvoiceVatMode;
  vatTouched: boolean;
  rateOverride: number | null;
  notes: string;
  lines: Omit<EditableInvoiceLine, "id">[];
  discountKind: DiscountKind;
  discountValue: string;
  companyId: string | null;
}

/** Черновик больше не нужен: инвойс выставлен или его бросили «Уйти». */
export function clearStoredInvoiceDraft(
  tenantId: string | null | undefined,
  team: string | null | undefined,
): void {
  if (tenantId) getStorage().remove(storedInvoiceDraftKey(tenantId, team));
}

/** НОВЫЙ ИНВОЙС ПЕРЕЖИВАЕТ ВЫГРУЗКУ ПРИЛОЖЕНИЯ (аудит 035, I-05).
 *
 *  «Назад» с набранным спрашивает «Уйти и потерять заполненное?», но iOS
 *  выгружает приложение из фона молча — клиент, позиции и скидка пропадали.
 *  Набранное лежит снимком в памяти телефона и поднимается при следующем
 *  «Новом инвойсе». Как у нового клиента (`useClientDraft/stored.ts`).
 *
 *  Только у инвойса «с нуля»: инвойс из записи, операции или клиента несёт
 *  контекст своего экрана, и поднимать его в другом месте нельзя (`key`
 *  тогда `null`). */
export function useStoredInvoiceDraft({
  key,
  snapshot,
  dirty,
  restore,
}: {
  key: string | null;
  snapshot: StoredInvoiceDraft;
  dirty: boolean;
  restore: (stored: StoredInvoiceDraft) => void;
}) {
  const restored = useRef(false);
  const latest = useRef({ dirty, restore });
  latest.current = { dirty, restore };

  // Подъём — один раз, как только известна компания (до неё ключа нет), и
  // только в нетронутую форму: набранное не затираем.
  useEffect(() => {
    if (!key || restored.current) return;
    restored.current = true;
    const stored = getStorage().get<StoredInvoiceDraft>(key);
    if (stored && !latest.current.dirty) latest.current.restore(stored);
  }, [key]);

  // Снимок на каждое изменение: запись синхронная и дешёвая. Пока подъём не
  // прошёл, не пишем — иначе пустая форма стёрла бы снимок до чтения.
  const text = JSON.stringify(snapshot);
  useEffect(() => {
    if (!key || !restored.current) return;
    if (dirty) getStorage().set(key, JSON.parse(text) as StoredInvoiceDraft);
    else getStorage().remove(key);
  }, [key, text, dirty]);
}
