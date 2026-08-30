import type {
  AppointmentPayment,
  AppointmentService,
  Payment,
} from "@babun/shared/local/appointments";
import {
  durationForQuantity,
  pricePerUnit,
} from "@babun/shared/local/services";
import { round2 } from "@babun/shared/local/finance/appointment-calc";
import type { Service } from "@/features/services/queries";
import {
  parseDurationTiers,
  parsePriceTiers,
} from "@/features/services/economics";

export const pad2 = (n: number) => String(n).padStart(2, "0");

export function formatYMD(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function parseYMD(s: string): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  // Берём ТОЛЬКО первые 10 символов: из кэша дата иногда приезжает целым
  // ISO-штампом («2026-05-31T00:00:00»), и тогда день превращался в NaN —
  // а Invalid Date системный календарь показывает как «1 янв. 1970 г.».
  const [y, m, day] = s.slice(0, 10).split("-").map(Number);
  if (y && m && day) d.setFullYear(y, m - 1, day);
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

/** Duration inside one calendar day. Appointment rows don't span midnight;
 * invalid/reversed values therefore resolve to 0 instead of wrapping. */
export function minutesBetweenHM(start: string, end: string): number {
  const toMinutes = (value: string) => {
    if (!/^\d{2}:\d{2}$/.test(value)) return null;
    const [hours, minutes] = value.split(":").map(Number);
    if (
      !Number.isInteger(hours) ||
      !Number.isInteger(minutes) ||
      hours < 0 ||
      hours > 23 ||
      minutes < 0 ||
      minutes > 59
    ) {
      return null;
    }
    return hours * 60 + minutes;
  };
  const from = toMinutes(start);
  const to = toMinutes(end);
  return from == null || to == null || to <= from ? 0 : to - from;
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
  /**
   * ЗАМОК СОХРАНЁННОЙ СТРОКИ (2026-08-24). Пока он здесь, строка отдаёт ровно
   * те числа, которые записали в день записи, — цену, длительность и цену
   * каталога того дня. Без него открытие майской записи пересобирало её из
   * СЕГОДНЯШНЕГО каталога: поднял цену «Чистки» с €50 до €60 — и любой, кто
   * просто заглянул в запись, переписал её деньги, долг клиента на карточке
   * и упёрся в сторож оплаченной записи ради правки комментария.
   *
   * Замок снимает ровно одно действие — правка КОЛИЧЕСТВА: объём работ
   * изменился осознанно, новую сумму человек видит на том же экране, и
   * лестница обязана посчитать её по действующему прайсу.
   */
  locked?: LockedLine;
}

/** Что держит замок: три числа и два слова снимка. */
export interface LockedLine {
  pricePerUnit: number;
  originalPrice: number;
  duration: number;
  serviceName?: string;
  unit?: string | null;
}

// Unit price of a catalog row at the given quantity — bulk ladder via
// the shared pricePerUnit, one source of truth with the web
// (apps/web/src/lib/appointment-services.ts).
export function unitPriceFor(svc: Service, qty: number): number {
  const tiers = parsePriceTiers(svc.price_tiers);
  return pricePerUnit(
    {
      price: Number(svc.price),
      bulk_threshold: svc.bulk_threshold ?? 0,
      bulk_price: svc.bulk_price ?? 0,
      price_tiers: tiers.length > 0 ? tiers : undefined,
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
    const lock = ov?.locked;
    // КОЛИЧЕСТВО ЕСТЬ У КАЖДОЙ УСЛУГИ (2026-08-21). Флага «продаём целиком»
    // (`is_countable`) больше нет: он спрашивал в справочнике про поведение
    // ДРУГОГО экрана — степпера в записи, — и владелец справедливо не понял
    // вопроса. Правило только расширилось: ни одно уже записанное количество
    // не уменьшается, ни один байт снимка не меняется.
    const qty =
      ov?.qty != null && Number.isFinite(ov.qty) && ov.qty > 0
        ? Math.max(1, Math.floor(ov.qty))
        : 1;
    // Ручная цена оператора выигрывает у замка: он держит записанное, а не
    // запрещает править. Замок выигрывает у каталога.
    const price =
      ov?.price != null
        ? ov.price
        : lock
          ? lock.pricePerUnit
          : c
            ? unitPriceFor(c, qty)
            : 0;
    const durationTiers = c ? parseDurationTiers(c.duration_tiers) : [];
    const duration = lock
      ? lock.duration
      : c
        ? durationForQuantity(
            {
              duration_minutes: baseDuration,
              duration_tiers: durationTiers.length > 0 ? durationTiers : undefined,
            },
            qty,
          )
        : baseDuration * qty;
    return {
      serviceId: id,
      quantity: qty,
      pricePerUnit: price,
      // Цена каталога ТОГО ДНЯ, а не сегодняшняя: иначе простое открытие и
      // сохранение записи меняло бы байт снимка и будило сторож оплаченной.
      originalPrice: lock ? lock.originalPrice : catalogPrice,
      // Копейки, а не float-хвост: 50,01 × 3 в двоичной арифметике даёт
      // 150.03000000000003, и это число уезжало в базу и в счёт.
      totalPrice: round2(price * qty),
      duration,
      // ИМЯ И ЕДИНИЦА УЕЗЖАЮТ В СНИМОК. Услугу переименуют — прошлая запись
      // останется с тем словом, которым работу назвали тогда; услугу сотрут
      // насовсем — имя всё равно при ней. Замок держит и их: у сохранённой
      // строки берём записанное, у новой — сегодняшнее из каталога.
      serviceName: lock?.serviceName ?? c?.name ?? undefined,
      unit: lock ? lock.unit ?? null : c?.unit ?? null,
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
