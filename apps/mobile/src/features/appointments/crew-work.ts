import { getPaidAmount, type Appointment } from "@babun/shared/local/appointments";

import type { CrewBlocks } from "./crew-blocks";

// РАБОТЫ И ДЕНЬГИ ЗАПИСИ ГЛАЗАМИ КОМАНДЫ (STORY-084, волна 4).
//
// Сервер отдаёт мастеру строки работ по «Услугам в записи», цены и «Итого» —
// по «Сумме записи», статус оплаты — по «Оплате в записи». В режиме «его
// глазами» данные приходят владельцу целиком, поэтому то же правило
// применяется и здесь: экран показывает ровно то, что увидит человек.

export interface CrewWorkLine {
  key: string;
  name: string;
  /** Длительность работы — вторая строка, как в записи у владельца. */
  minutes: number;
  qty: number;
  unit: string | null;
  /** Цены — только при «Сумме». */
  pricePerUnit: number | null;
  total: number | null;
}

/** Строки работ. Снимок записи первым, справочник вторым: бригада на объекте
 *  должна видеть, что приехала делать, даже если услугу уже стёрли из прайса. */
export function crewWorkLines(
  appointment: Pick<Appointment, "services" | "service_ids">,
  catalogNames: ReadonlyMap<string, string>,
  blocks: Pick<CrewBlocks, "services" | "amount">,
): CrewWorkLine[] {
  if (!blocks.services) return [];
  const snapshot = appointment.services ?? [];
  if (snapshot.length > 0) {
    return snapshot.map((line, index) => ({
      key: `${line.serviceId}:${index}`,
      name: line.serviceName?.trim() || catalogNames.get(line.serviceId) || "Услуга удалена",
      minutes: line.duration,
      qty: line.quantity,
      unit: line.unit ?? null,
      pricePerUnit: blocks.amount ? line.pricePerUnit : null,
      total: blocks.amount ? line.totalPrice : null,
    }));
  }
  // Записи до снимка строк: только имена из справочника, без количества и цен.
  return appointment.service_ids.map((id, index) => ({
    key: `${id}:${index}`,
    name: catalogNames.get(id) ?? "Услуга удалена",
    minutes: 0,
    qty: 1,
    unit: null,
    pricePerUnit: null,
    total: null,
  }));
}

const PAYMENT_WORD: Record<NonNullable<Appointment["payment_status"]>, string> = {
  unpaid: "Не оплачено",
  partial: "Оплачено частично",
  paid: "Оплачено",
  refunded: "Возврат",
};

export interface CrewMoney {
  /** «Итого» — только при «Сумме». */
  total: number | null;
  /** Скидка называется, только когда она есть и видна сумма. */
  discount: number | null;
  /** Строка оплаты — при «Оплате»; сколько внесено — ещё и при «Сумме». */
  payment: { word: string; paid: number | null } | null;
}

export function crewMoney(
  appointment: Appointment,
  blocks: Pick<CrewBlocks, "amount" | "payment">,
): CrewMoney {
  const paid = getPaidAmount(appointment);
  return {
    total: blocks.amount ? appointment.total_amount : null,
    discount: blocks.amount && appointment.discount_amount > 0 ? appointment.discount_amount : null,
    payment:
      blocks.payment === "hidden"
        ? null
        : {
            word: PAYMENT_WORD[appointment.payment_status ?? "unpaid"],
            paid: blocks.amount && paid > 0 ? paid : null,
          },
  };
}
