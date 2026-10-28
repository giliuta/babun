import type { Discount } from "@babun/shared/local/appointments";
import type { TxVatMode } from "@babun/shared/local/finance/vat";
import { globalDiscountAmount } from "@babun/shared/local/finance/appointment-calc";
import type { Service } from "@/features/services/queries";
import { buildServices, type ServiceOverride } from "@/features/appointments/helpers";
import { serviceBuffersMinutes } from "./book-math";
import { recordTotals, typedDiscount } from "./book-money";

export interface BookTotalsMathInput {
  serviceIds: string[];
  catalog: Map<string, Service>;
  overrides: Record<string, ServiceOverride>;
  discountType: Discount["type"] | null;
  discountValue: string;
  discountReason: string | null;
  recordVatMode: TxVatMode;
  recordVatRate: number | null;
  /** Ставка, которую команда помнит, когда у записи своей нет. */
  rememberedRate: number;
  customTotal: boolean;
  totalDraft: string;
}

/** Строки, длительность, скидка, налог и итог записи — одной чистой функцией.
 *  Её зовут и форма (`useBookTotals`), и эталон «как было» у правки
 *  (`open-baseline.ts`): один расчёт на обе стороны сравнения. */
export function bookTotalsMath(input: BookTotalsMathInput) {
  const {
    serviceIds, catalog, overrides, discountType, discountValue, discountReason,
    recordVatMode, recordVatRate, rememberedRate, customTotal, totalDraft,
  } = input;
  const selectedServices = buildServices(serviceIds, catalog, overrides);
  const computedTotal = selectedServices.reduce((s, x) => s + x.totalPrice, 0);
  const computedDuration =
    selectedServices.reduce((s, x) => s + x.duration, 0) +
    serviceBuffersMinutes(serviceIds, catalog);
  const globalDiscount: Discount | null = typedDiscount(discountType, discountValue, discountReason);
  const discountAmount = globalDiscountAmount(selectedServices, globalDiscount);
  const vatRateInUse = recordVatRate ?? rememberedRate;
  const { beforeVat, automaticTotal, effectiveTotal } = recordTotals({
    computedTotal,
    discountAmount,
    recordVatMode,
    vatRateInUse,
    customTotal,
    totalDraft,
  });
  return {
    selectedServices,
    computedTotal,
    computedDuration,
    globalDiscount,
    discountAmount,
    vatRateInUse,
    beforeVat,
    automaticTotal,
    effectiveTotal,
  };
}
