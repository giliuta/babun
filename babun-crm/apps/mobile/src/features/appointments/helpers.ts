import type { AppointmentService } from "@babun/shared/local/appointments";
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

export function addMinutesHM(hm: string, minutes: number): string {
  const [h, m] = hm.split(":").map(Number);
  const total = (h || 0) * 60 + (m || 0) + minutes;
  const norm = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${pad2(Math.floor(norm / 60))}:${pad2(norm % 60)}`;
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
