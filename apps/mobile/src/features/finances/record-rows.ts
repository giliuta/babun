import type { Appointment } from "@babun/shared/local/appointments";
import {
  signedAmount,
  type FinanceTransaction,
} from "@babun/shared/local/finance/transaction";
import {
  FORMS_PLATEZH,
  formatCountRu,
} from "@babun/shared/common/utils/plural-ru";

// ОДИН ВИЗИТ — ОДНА СТРОКА (владелец 2026-09-08: «нам без разницы, предоплата,
// доплата или переплата: это всё единая сумма, зафиксированная за этой
// записью»).
//
// Лента операций — это лента ПРОВОДОК: визит с предоплатой и доплатой даёт в
// ней две строки, частичный возврат — третью, и в разрезе «Доход» человек
// видит одну работу трижды. Здесь проводки одного `appointment_id` сходятся в
// одну строку: клиент титулом, услуги подстрокой, сумма визита справа.
//
// Доход и расход НЕ схлопываются между собой (владелец там же: «доход 135
// стоит целиком, расход 10 стоит целиком, а в прибыли уже 135 − 10»). Эта
// функция считает ОДИН разрез: что ей дали, то и сложила. Вычитание живёт в
// плитке «Прибыль», а не здесь.
//
// Проводка без записи (бензин, обеды, зарплата) остаётся сама собой: у неё
// нет ни клиента, ни услуг, и шаблон «клиент + услуги» сложился бы для неё с
// пустыми полями. Такая строка приходит своим видом — `appointmentId: null`.

export interface RecordRow {
  /** Ключ списка: id записи либо id одиночной проводки. */
  key: string;
  /** Запись, которую откроет тап. `null` — ручная операция, записи нет. */
  appointmentId: string | null;
  /** КТО. Имя клиента; у ручной операции — категория или заметка. */
  title: string;
  /** ЧТО. Имена услуг визита в порядке записи; у ручной операции пусто. */
  services: string[];
  /** СКОЛЬКО. Нетто разреза: все проводки визита сложены со своим знаком. */
  amount: number;
  /** КОГДА. Дата визита (у ручной — дата операции), YYYY-MM-DD. */
  date: string;
  /** Время визита или операции, HH:MM. `null` — времени нет. */
  time: string | null;
  /** Сколько проводок сложилось в строку. 1 — складывать было нечего. */
  count: number;
}

export interface RecordRowRefs {
  appointments: readonly Appointment[];
  clients: readonly { id: string; full_name: string }[];
  services: readonly { id: string; name: string }[];
  categories: readonly { id: string; name: string }[];
}

/** Имена услуг визита. Снимок в записи сильнее каталога: услугу могли
 *  переименовать или удалить, а на бумаге визита осталось имя того дня. */
function serviceNames(
  appointment: Appointment,
  catalog: Map<string, string>,
): string[] {
  const fromSnapshot = (appointment.services ?? [])
    .map((s) => s.serviceName?.trim() || catalog.get(s.serviceId) || "")
    .filter(Boolean);
  if (fromSnapshot.length > 0) return fromSnapshot;
  return (appointment.service_ids ?? [])
    .map((id) => catalog.get(id) ?? "")
    .filter(Boolean);
}

export function recordRows(
  transactions: readonly FinanceTransaction[],
  refs: RecordRowRefs,
): RecordRow[] {
  const appointment = new Map(refs.appointments.map((a) => [a.id, a]));
  const client = new Map(refs.clients.map((c) => [c.id, c.full_name]));
  const catalog = new Map(refs.services.map((s) => [s.id, s.name]));
  const category = new Map(refs.categories.map((c) => [c.id, c.name]));

  const byRecord = new Map<string, RecordRow>();
  const rows: RecordRow[] = [];

  for (const tx of transactions) {
    const apt = tx.appointment_id ? appointment.get(tx.appointment_id) : null;
    // Проводка ссылается на запись, которой нет в окне периода (визит в
    // прошлом месяце, деньги в этом). Складывать её не с чем — печатаем как
    // одиночную, иначе строка потеряется вовсе.
    if (!apt) {
      rows.push({
        key: tx.id,
        appointmentId: null,
        title:
          (tx.category_id ? category.get(tx.category_id) : null) ||
          tx.notes?.trim() ||
          "Операция",
        services: [],
        amount: signedAmount(tx),
        date: tx.occurred_on,
        time: tx.occurred_time,
        count: 1,
      });
      continue;
    }
    const existing = byRecord.get(apt.id);
    if (existing) {
      existing.amount += signedAmount(tx);
      existing.count += 1;
      continue;
    }
    const row: RecordRow = {
      key: apt.id,
      appointmentId: apt.id,
      title:
        (apt.client_id ? client.get(apt.client_id) : null) || "Без клиента",
      services: serviceNames(apt, catalog),
      amount: signedAmount(tx),
      // Время визита, а не проводки: деньги по записи могли записать вечером,
      // но в списке работ строка стоит там, где стояла работа.
      date: apt.date,
      time: apt.time_start ? apt.time_start.slice(0, 5) : tx.occurred_time,
      count: 1,
    };
    byRecord.set(apt.id, row);
    rows.push(row);
  }

  // Копейки после сложения нескольких платежей: 44.4 + 34.4 даёт 78.80000001.
  for (const row of rows) row.amount = Math.round(row.amount * 100) / 100;

  return rows.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    const at = a.time ?? "";
    const bt = b.time ?? "";
    if (at !== bt) return at < bt ? 1 : -1;
    return a.key < b.key ? 1 : -1;
  });
}

/** Сколько имён услуг печатаем целиком, прежде чем свернуть остаток в «+N». */
const SERVICES_SHOWN = 2;

/** ЧТО сделали — одной строкой. Усечение здесь ПРАВИЛО, а не `numberOfLines`
 *  наугад: без «+N» третья услуга съедала бы имя клиента. */
export function servicesLine(services: readonly string[]): string {
  if (services.length === 0) return "";
  const shown = services.slice(0, SERVICES_SHOWN).join(" · ");
  const rest = services.length - SERVICES_SHOWN;
  return rest > 0 ? `${shown} +${rest}` : shown;
}

/** КОГДА — время визита и, если платежей было несколько, их число. */
export function whenLine(row: Pick<RecordRow, "time" | "count">): string {
  return [row.time, row.count > 1 ? formatCountRu(row.count, FORMS_PLATEZH) : null]
    .filter(Boolean)
    .join(" · ");
}
