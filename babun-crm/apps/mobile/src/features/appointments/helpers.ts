import type {
  AppointmentPayment,
  AppointmentService,
  Payment,
} from "@babun/shared/local/appointments";
import { pricePerUnit, type PriceTier } from "@babun/shared/local/services";
import type { Service } from "@/features/services/queries";

export const pad2 = (n: number) => String(n).padStart(2, "0");

export function formatYMD(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function parseYMD(s: string): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const [y, m, day] = s.split("-").map(Number);
  if (y) d.setFullYear(y, (m || 1) - 1, day || 1);
  return d;
}

export function formatHM(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function parseHM(s: string, base?: Date): Date {
  const d = base ? new Date(base) : new Date();
  const [h, m] = s.split(":").map(Number);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

// Конец слота = старт + минуты, БЕЗ заворота через полночь: тап по
// слоту 23:30 не должен давать конец «00:00» раньше начала (Alert при
// сохранении). Клампим к 23:59 — визит через полночь бронируется двумя
// записями (та же семантика, что live-пересчёт конца в шите).
export function addMinutesHM(hm: string, minutes: number): string {
  const [h, m] = hm.split(":").map(Number);
  const total = Math.max(
    0,
    Math.min(23 * 60 + 59, (h || 0) * 60 + (m || 0) + minutes),
  );
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

// Денежный ввод с клавиатуры: запятая — десятичный разделитель
// (EU-раскладка decimal-pad шлёт «12,5»), мусор и отрицательные → 0.
export function parseMoneyInput(s: string): number {
  const n = Number(s.trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Зеркало payment-объекта из ПОЛНОГО леджера payments[] (единственный
// источник правды списка): суммы нал/карта по всем платежам, split когда
// были оба — та же свёртка, что миграция payments→payment в shared
// loadAppointments. Зеркалить только последний платёж нельзя: split-
// история (часть налом раньше, остаток картой сейчас) терялась бы.
export function paymentMirrorFromLedger(
  payments: Payment[],
): AppointmentPayment | null {
  let cash = 0;
  let card = 0;
  for (const p of payments) {
    if (p.method === "cash") cash += p.amount;
    else if (p.method === "card") card += p.amount;
  }
  if (cash + card === 0) return null;
  return {
    method: cash > 0 && card > 0 ? "split" : cash > 0 ? "cash" : "card",
    cashAmount: cash,
    cardAmount: card,
    paid_at: payments[payments.length - 1]?.paid_at ?? new Date().toISOString(),
  };
}

export interface ServiceOverride {
  qty?: number;
  price?: number;
}

// The DB row stores price_tiers as loose Json — validate the shape
// before feeding it to the shared pricing ladder.
function parsePriceTiers(raw: unknown): PriceTier[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const tiers: PriceTier[] = [];
  for (const t of raw) {
    if (t == null || typeof t !== "object") continue;
    const { min_qty, price_per_unit } = t as Record<string, unknown>;
    if (typeof min_qty === "number" && typeof price_per_unit === "number") {
      tiers.push({ min_qty, price_per_unit });
    }
  }
  return tiers.length ? tiers : undefined;
}

// Unit price of a catalog row at the given quantity — bulk ladder via
// the shared pricePerUnit, one source of truth with the web
// (apps/web/src/lib/appointment-services.ts).
export function unitPriceFor(svc: Service, qty: number): number {
  return pricePerUnit(
    {
      price: Number(svc.price),
      bulk_threshold: svc.bulk_threshold ?? 0,
      bulk_price: svc.bulk_price ?? 0,
      price_tiers: parsePriceTiers(svc.price_tiers),
    },
    qty,
  );
}

// Build the appointment's services[] from selected catalog ids, applying
// per-service quantity / price overrides when present. An explicit
// operator price wins; otherwise the bulk ladder reprices per quantity.
export function buildServices(
  serviceIds: string[],
  catalog: Map<string, Service>,
  overrides?: Record<string, ServiceOverride>,
): AppointmentService[] {
  return serviceIds.map((id) => {
    const c = catalog.get(id);
    const catalogPrice = c ? Number(c.price) : 0;
    const baseDuration = c ? c.duration_minutes : 60;
    const ov = overrides?.[id];
    const qty = ov?.qty != null && ov.qty > 0 ? ov.qty : 1;
    const price = ov?.price != null ? ov.price : c ? unitPriceFor(c, qty) : 0;
    return {
      serviceId: id,
      quantity: qty,
      pricePerUnit: price,
      originalPrice: catalogPrice,
      totalPrice: price * qty,
      duration: baseDuration * qty,
    };
  });
}

const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

// "ср, 15 июля" — human day label from YYYY-MM-DD.
export function humanDay(ymd: string): string {
  if (!ymd) return "—";
  const d = parseYMD(ymd);
  if (Number.isNaN(d.getTime())) return ymd;
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
