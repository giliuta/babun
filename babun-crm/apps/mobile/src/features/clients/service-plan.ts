import type { Appointment } from "@babun/shared/local/appointments";
import type { Location } from "@babun/shared/local/clients";

// РЕГУЛЯРНОЕ ОБСЛУЖИВАНИЕ — «когда сюда пора снова».
//
// Возврат постоянного клиента — основная выручка сервиса, и он же самая
// частая потеря: никто не помнит, что виллу моют раз в месяц, а сплиты чистят
// раз в полгода. Раньше это жило на «технике» с датами ТО; техника ушла как
// чужой словарь, а сама регулярность нужна всем — клинингу, бассейнам,
// кондиционерщикам.
//
// Правило простое и без ручного ввода: интервал задаётся на объекте, точка
// отсчёта — ПОСЛЕДНИЙ ВИЗИТ на этот объект. Календарь это и так знает,
// поэтому «дату последнего обслуживания» никто не заполняет и не забывает.

export const SERVICE_INTERVALS: { months: number; label: string }[] = [
  { months: 1, label: "Раз в месяц" },
  { months: 2, label: "Раз в 2 месяца" },
  { months: 3, label: "Раз в 3 месяца" },
  { months: 6, label: "Раз в полгода" },
  { months: 12, label: "Раз в год" },
];

export function intervalLabel(months: number | undefined | null): string | null {
  if (!months) return null;
  return (
    SERVICE_INTERVALS.find((i) => i.months === months)?.label ??
    `Раз в ${months} мес.`
  );
}

export interface ServicePlan {
  /** Когда пора приехать снова (YYYY-MM-DD). */
  dueYmd: string;
  /** Сколько дней осталось; отрицательное — просрочено. */
  daysLeft: number;
  /** Просрочено или ровно сегодня. */
  due: boolean;
  /** Готовая подпись строки объекта. */
  text: string;
}

/** Прибавить месяцы к YYYY-MM-DD, не выходя за конец месяца (31 янв + 1 мес
 *  = 28/29 фев, а не 3 марта). */
export function addMonthsYmd(ymd: string, months: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const targetMonth = m - 1 + months;
  const year = y + Math.floor(targetMonth / 12);
  const month = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${year}-${p(month + 1)}-${p(day)}`;
}

function daysBetween(fromYmd: string, toYmd: string): number {
  const a = Date.parse(`${fromYmd}T00:00:00Z`);
  const b = Date.parse(`${toYmd}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** Последний состоявшийся визит НА ЭТОТ объект (YYYY-MM-DD) или null.
 *
 *  ОДНО ПРАВИЛО СО СПИСКОМ: те же условия считает `buildStats` в shared
 *  (поле `serviceDue`) — неотменённая запись с прошедшей датой. Пока
 *  условия расходились (там только «завершённые», тут «любые кроме
 *  отменённых»), строка объекта говорила «Пора обслужить», а статус в
 *  списке молчал — и наоборот. */
export function lastVisitToLocation(
  appts: readonly Appointment[],
  locationId: string,
  todayYmd: string,
): string | null {
  let last: string | null = null;
  for (const a of appts) {
    if (a.status === "cancelled") continue;
    if (a.location_id !== locationId) continue;
    if (!a.date || a.date > todayYmd) continue;
    if (!last || a.date > last) last = a.date;
  }
  return last;
}

export function servicePlan(
  loc: Location,
  appts: readonly Appointment[],
  todayYmd: string,
): ServicePlan | null {
  const months = loc.serviceEveryMonths ?? 0;
  if (!months) return null;
  const last = lastVisitToLocation(appts, loc.id, todayYmd);
  // Ни одного визита — обслуживать нечего, отсчёт начнётся с первого.
  if (!last) return null;
  const dueYmd = addMonthsYmd(last, months);
  const daysLeft = daysBetween(todayYmd, dueYmd);
  return {
    dueYmd,
    daysLeft,
    due: daysLeft <= 0,
    text:
      daysLeft <= 0
        ? "Пора обслужить"
        : daysLeft <= 14
          ? `Обслужить через ${daysLeft} ${dayWord(daysLeft)}`
          : `Следующее — ${humanYmd(dueYmd)}`,
  };
}

function dayWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "дня";
  return "дней";
}

const MONTHS_RU = [
  "янв", "фев", "мар", "апр", "мая", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек",
];

function humanYmd(ymd: string): string {
  const [, m, d] = ymd.split("-");
  const idx = Number(m) - 1;
  return `${Number(d)} ${MONTHS_RU[idx] ?? ""}`.trim();
}
