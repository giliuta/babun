// ЦЕНА ОДНОГО КАЛЕНДАРЯ (€9,99 в месяц, €7,99 при оплате за
// год) — лист без зависимостей, кроме формата денег: его читают страница
// «Тариф», предложение «Новый календарь» и тест, сверяющий цену с
// `tariff-checkout`.

import { money } from "@babun/shared/common/utils/money";

export const CALENDAR_PRICE = { monthly: 9.99, yearlyMonthly: 7.99 } as const;

/** Цена тарифа — тем же форматом, что все деньги продукта (`money`):
 *  свой `toFixed(2)` давал «€9.99» на «Тарифе» рядом с «€0,12» на «SMS».
 *  Валюта названа явно: тариф всегда в евро, а `money` без неё берёт валюту
 *  аккаунта. */
export const euro = (n: number) => money(n, "EUR");

/** Сколько в месяц за столько календарей: «€29,97». */
export function calendarsMonthly(calendars: number): string {
  return euro(CALENDAR_PRICE.monthly * Math.max(1, calendars));
}

/** ЗА КАКОЙ КАЛЕНДАРЬ ПЛАТЯТ: живой, в котором есть РАБОТА — запись
 *  (`appointments.kind = 'work'`), операция финансов или SMS. Календарь только
 *  с событиями бесплатен, как бы он ни назывался («Личный», пустой скрытый).
 *
 *  Сервер считает функцией базы `paid_calendar_count` (её зовут
 *  `tariff-checkout` и `stripe-webhook`), приложение — этим же списком своими
 *  запросами (`features/tariffs/use-live-calendars.ts`), поэтому страница
 *  «Тариф» работает и до наката функции. Список и SQL сверяет
 *  `paid-calendars-parity.test.ts`: разойдутся — человек увидит одну сумму, а
 *  Stripe спишет другую. */
export const CALENDAR_WORK_SOURCES = [
  { table: "appointments", kind: "work" },
  { table: "finance_transactions" },
  { table: "sms_messages" },
] as const;

/** Сколько живых календарей платят: те, где нашлась работа. Минимум в
 *  подписке (один) ставит тот, кто показывает цену. */
export function paidCalendarCount(liveTeamIds: readonly string[], withWork: ReadonlySet<string>): number {
  return liveTeamIds.filter((id) => withWork.has(id)).length;
}

/** Строка сводки `calendar_work_summary`: живой календарь и есть ли в нём
 *  работа — по тем же `CALENDAR_WORK_SOURCES`, одним вызовом. */
export type CalendarWorkRow = { team_id: string; has_work: boolean };

/** Сколько живых календарей платят — по сводке сервера. */
export function paidFromSummary(rows: readonly CalendarWorkRow[]): number {
  return paidCalendarCount(
    rows.map((row) => row.team_id),
    new Set(rows.filter((row) => row.has_work).map((row) => row.team_id)),
  );
}

/** Ровно то, что нужно от клиента базы, чтобы спросить «есть ли строка»:
 *  клиент Supabase этому удовлетворяет, тест — подставляет свой. */
export interface WorkQuery {
  select(columns: string): WorkQuery;
  eq(column: string, value: string): WorkQuery;
  limit(count: number): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
}
export interface WorkClient {
  from(table: (typeof CALENDAR_WORK_SOURCES)[number]["table"]): WorkQuery;
}

/** Есть ли в календаре работа — по `CALENDAR_WORK_SOURCES` по порядку:
 *  нашлась запись — операции и SMS уже не спрашиваем. Каждая проверка —
 *  «есть хоть одна строка» (`limit(1)`), а не выборка всего календаря.
 *  Ошибка чтения — исключение, а не «работы нет»: молчаливый ноль показал бы
 *  бесплатным календарь, за который спишут. */
export async function calendarHasWork(client: WorkClient, tenantId: string, teamId: string): Promise<boolean> {
  for (const source of CALENDAR_WORK_SOURCES) {
    let query = client.from(source.table).select("team_id").eq("tenant_id", tenantId).eq("team_id", teamId);
    if ("kind" in source) query = query.eq("kind", source.kind);
    const { data, error } = await query.limit(1);
    if (error) throw new Error(error.message);
    if ((data ?? []).length > 0) return true;
  }
  return false;
}

/** Период оплаты: помесячно или на год вперёд. */
export type BillingPeriod = "month" | "year";

/** Сколько за год за столько календарей: «€287,64» (€7,99 × 12 × 3). */
export function calendarsYearly(calendars: number): string {
  return euro(Math.round(CALENDAR_PRICE.yearlyMonthly * 12 * Math.max(1, calendars) * 100) / 100);
}
