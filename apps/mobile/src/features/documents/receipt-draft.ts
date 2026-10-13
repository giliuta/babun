import { useState } from "react";
import type { AppointmentService, Discount } from "@babun/shared/local/appointments";
import {
  globalDiscountAmount,
  lineTotal,
  round2,
  subtotal,
} from "@babun/shared/local/finance/appointment-calc";
import type { TxVatMode } from "@babun/shared/local/finance/vat";
import type { DiscountKind } from "@/features/appointments/TotalSheet";
import type { Service } from "@/features/services/queries";

export interface ReceiptDraftState {
  /** Команда, в которой выписывают чек. ВЫБОРА ЕЁ В ЧЕКЕ НЕТ (владелец
   *  2026-09-20: «выбор команды я думаю это лишнее») — она приезжает чипом с
   *  «Финансов» и молча решает одно: какие кассы показать. */
  teamId: string | null;
  clientId: string | null;
  accountId: string | null;
  /** Какими реквизитами подписан чек. `null` — берём основные: документ не
   *  должен требовать выбора там, где ответ и так известен. */
  companyId: string | null;
  /** День и время приёма денег — ровно как у операции. */
  date: string;
  /** Объект клиента — как у инвойса (владелец 04.10: «выписать чек на
   *  принятие оплаты именно на этот объект»). */
  locationId: string | null;
  /** Набор реквизитов клиента; `null` — основной, `"none"` — на имя. */
  clientRequisitesId: string | null;
  lines: AppointmentService[];
  discountType: DiscountKind;
  /** Сырой текст поля скидки — разбор живёт здесь, как в записи. */
  discountValue: string;
  /** НАЛОГ ПО УМОЛЧАНИЮ ВЫКЛЮЧЕН (владелец 2026-09-20: «НДС почему-то
   *  добавляется или он включён — так не должно быть»). Настройка компании
   *  его больше НЕ включает сама: документ печатает только то, что человек
   *  выбрал клавишей в «Итого». */
  vatMode: TxVatMode;
  /** Ставка, выбранная тапом по ней в «Итого» (владелец 2026-09-22).
   *  Пусто — ставка из настроек (счёт → команда → компания). */
  vatRate?: number | null;
}

export function useReceiptDraft(
  today: string,
  presetTeamId: string | null,
): [ReceiptDraftState, (next: Partial<ReceiptDraftState>) => void] {
  const [draft, setDraft] = useState<ReceiptDraftState>(() => ({
    teamId: presetTeamId,
    clientId: null,
    accountId: null,
    companyId: null,
    date: today,
    locationId: null,
    clientRequisitesId: null,
    lines: [],
    discountType: "percent",
    discountValue: "",
    vatMode: "none",
  }));
  return [draft, (next) => setDraft((prev) => ({ ...prev, ...next }))];
}

/** Скидка черновика — той же сущностью `Discount`, что у записи. */
export function receiptDiscount(draft: ReceiptDraftState): Discount | null {
  const value = Number(draft.discountValue.replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return null;
  return { type: draft.discountType, value };
}

/** Итог черновика. Один расчёт на бумагу, на проводку и на строку «Итого» —
 *  теми же функциями, которыми считает запись (`appointment-calc`). */
export function receiptTotals(draft: ReceiptDraftState) {
  const discount = receiptDiscount(draft);
  const works = subtotal(draft.lines);
  const discountAmount = globalDiscountAmount(draft.lines, discount);
  return {
    works,
    discountAmount,
    total: round2(Math.max(0, works - discountAmount)),
  };
}

/** Строки чека для сервера — из тех же строк работ, что на экране. */
export function receiptLinesForServer(
  draft: ReceiptDraftState,
  nameFor: (line: AppointmentService) => string,
) {
  return draft.lines.map((line) => ({
    name: nameFor(line),
    qty: line.quantity,
    unit: line.unit ?? null,
    unitPrice: line.pricePerUnit,
    sum: lineTotal(line),
  }));
}

/** Новая строка работ — теми же полями, что кладёт запись. */
export function newLine(svc: Service): AppointmentService {
  return recalc(
    {
      serviceId: svc.id,
      quantity: 1,
      pricePerUnit: svc.price,
      originalPrice: svc.price,
      totalPrice: svc.price,
      // Длительность строки — базовая длительность услуги: `recalc` умножит
      // её на количество, как в записи.
      duration: svc.duration_minutes,
      serviceName: svc.name,
      unit: svc.unit,
    },
    {},
  );
}

/** Пересчёт строки после правки количества или цены — тем же `lineTotal`,
 *  которым считает запись. Длительность идёт за количеством: одна услуга на
 *  два кондиционера занимает вдвое больше времени. */
export function recalc(
  line: AppointmentService,
  patch: Partial<Pick<AppointmentService, "quantity" | "pricePerUnit">>,
): AppointmentService {
  const perOne = line.quantity > 0 ? line.duration / line.quantity : line.duration;
  const next = { ...line, ...patch };
  return {
    ...next,
    totalPrice: lineTotal(next),
    duration: Math.round(perOne * next.quantity),
  };
}
