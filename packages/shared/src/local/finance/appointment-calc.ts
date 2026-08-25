// MEGA-UPDATE: pure calculation helpers for a multi-service
// appointment with per-line and global discounts.
//
// Все функции чистые, не трогают DOM / localStorage. Поддерживают
// легковесный unit-testing в будущем (пока без Vitest).

import type { AppointmentService, Discount } from "../appointments";
import {
  costPerUnit,
  type ServiceCostSource,
} from "../services";

export interface AppointmentMaterialSource {
  service_ids?: unknown;
  services?: unknown;
}

export interface MaterialCatalogService extends ServiceCostSource {
  id: string;
  name?: string;
}

export interface AppointmentMaterialCostLine {
  serviceId: string;
  serviceName: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
}

function materialQuantity(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : 1;
}

/** Material-cost lines use the quantity snapshot saved on an appointment.
 * Old appointments without services[] fall back to one unit per service_id. */
export function appointmentMaterialCostLines(
  appointment: AppointmentMaterialSource,
  services: readonly MaterialCatalogService[],
): AppointmentMaterialCostLine[] {
  const quantityByService = new Map<string, number>();
  const snapshotIds = new Set<string>();
  const snapshot = Array.isArray(appointment.services)
    ? appointment.services
    : [];

  for (const rawLine of snapshot) {
    if (
      rawLine === null ||
      typeof rawLine !== "object" ||
      Array.isArray(rawLine)
    ) {
      continue;
    }
    const line = rawLine as { serviceId?: unknown; quantity?: unknown };
    if (typeof line.serviceId !== "string" || line.serviceId.length === 0) {
      continue;
    }
    snapshotIds.add(line.serviceId);
    quantityByService.set(
      line.serviceId,
      (quantityByService.get(line.serviceId) ?? 0) +
        materialQuantity(line.quantity),
    );
  }

  const legacyIds = Array.isArray(appointment.service_ids)
    ? appointment.service_ids
    : [];
  for (const rawId of legacyIds) {
    if (typeof rawId !== "string" || rawId.length === 0 || snapshotIds.has(rawId)) {
      continue;
    }
    quantityByService.set(rawId, (quantityByService.get(rawId) ?? 0) + 1);
  }

  const serviceById = new Map(services.map((service) => [service.id, service]));
  const lines: AppointmentMaterialCostLine[] = [];
  for (const [serviceId, quantity] of quantityByService) {
    const service = serviceById.get(serviceId);
    if (!service) continue;
    // РАСХОД БЕРЁТСЯ ПО КОЛИЧЕСТВУ (2026-08-21): у услуги может быть своя
    // лестница расхода — та же химия дешевле оптом. Без количества здесь
    // работала бы только первая строка.
    const unitCost = costPerUnit(service, quantity);
    const totalCost = unitCost * quantity;
    if (totalCost <= 0) continue;
    lines.push({
      serviceId,
      serviceName: service.name?.trim() || "Услуга",
      quantity,
      unitCost,
      totalCost,
    });
  }
  return lines;
}

export function appointmentMaterialCost(
  appointment: AppointmentMaterialSource,
  services: readonly MaterialCatalogService[],
): number {
  return appointmentMaterialCostLines(appointment, services).reduce(
    (sum, line) => sum + line.totalCost,
    0,
  );
}

/** ДЕНЬГИ ОКРУГЛЯЮТСЯ ДО КОПЕЕК, А НЕ ДО ЕВРО (2026-08-18).
 *
 *  Здесь стоял `Math.round`, то есть до целого евро: услуга за 50,01 €
 *  превращалась в 50 в тот момент, когда запись открывали или пересчитывали,
 *  и «Итого» расходилось с прайсом на глазах. Целыми евро деньги в продукте не
 *  считает больше никто: остатки счетов, операции и инвойсы живут в центах.
 *
 *  Копейка — предел точности, дальше округлять нечего: цена за штуку у
 *  ступеней уже задаётся с двумя знаками, а float-хвосты («10 − 1.12 =
 *  8.879999…») эта же функция и снимает. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Apply a discount to a number; clamped to [0, base]. */
export function applyDiscount(base: number, discount?: Discount | null): number {
  if (!discount) return base;
  const off =
    discount.type === "percent"
      ? (base * discount.value) / 100
      : discount.value;
  return Math.max(0, base - off);
}

/** Per-line total: qty × pricePerUnit − line discount. */
export function lineTotal(line: AppointmentService): number {
  const base = line.quantity * line.pricePerUnit;
  return round2(applyDiscount(base, line.discount));
}

/** Sum of line totals. */
export function subtotal(services: AppointmentService[]): number {
  return round2(services.reduce((acc, l) => acc + lineTotal(l), 0));
}

/** Total = subtotal − globalDiscount. */
export function appointmentTotal(
  services: AppointmentService[],
  globalDiscount?: Discount | null
): number {
  const sub = subtotal(services);
  return round2(applyDiscount(sub, globalDiscount));
}

/** Sum of line durations — кешируется в appointment.total_duration. */
export function totalDuration(services: AppointmentService[]): number {
  return services.reduce((acc, l) => acc + l.duration, 0);
}

/** Рассчитать globalDiscount amount (в евро) для отображения. */
export function globalDiscountAmount(
  services: AppointmentService[],
  globalDiscount?: Discount | null
): number {
  if (!globalDiscount) return 0;
  const sub = subtotal(services);
  const after = applyDiscount(sub, globalDiscount);
  return round2(sub - after);
}

/** ДОЛГ ЗАПИСИ — В ЦЕЛЫХ ЦЕНТАХ.
 *
 *  `total − paid` во float даёт двоичный хвост ВНИЗ (10 − 1.12 =
 *  8.879999999999999). Шит записи предзаполняет поле оплаты долгом,
 *  округлённым до копеек (8.88), и тут же сравнивает его с неокруглённым
 *  долгом: собственная подстановка «вся сумма» оказывалась БОЛЬШЕ долга,
 *  кнопка «Сохранить» гасла, и принятую оплату нельзя было записать вообще.
 *  Тот же дефект уже чинили в возвратах (features/finances/refund.ts) — там
 *  расчёт живёт под тестом, поэтому и здесь он живёт здесь, а не в JSX.
 *
 *  «Возвращено» — терминальное состояние старого платёжного цикла: денег к
 *  зачёту и долга нет, повторное обслуживание начинается новой заявкой.
 */
export function appointmentDebtCents(
  total: number,
  paid: number,
  paymentStatus?: string | null,
): number {
  if (paymentStatus === "refunded") return 0;
  if (!Number.isFinite(total) || !Number.isFinite(paid)) return 0;
  return Math.max(0, Math.round(total * 100) - Math.round(paid * 100));
}
