import {
  getDebtAmount,
  type Appointment,
} from "@babun/shared/local/appointments";
import {
  appointmentServiceNames,
  debtAge,
  type RecordRow,
} from "./record-rows";

// ДОЛГ — ТАКАЯ ЖЕ СТРОКА-ЗАПИСЬ, КАК ДОХОД И РАСХОД (владелец 2026-09-09:
// «общая — это когда по времени там сразу долг, доход и расход, всё это туда
// закидывается»). Долг висел только на своей плитке, и в общей ленте его не
// было вовсе: €57 показаны, а найти их негде.
//
// Правило набора здесь ОДНО на продукт, и это важнее удобства: список под
// цифрой обязан сходиться с самой цифрой, иначе владелец перестаёт верить
// обеим. Раньше правило жило внутри DebtorsList, и общая лента не могла взять
// его, не скопировав.

export interface DebtRow extends RecordRow {
  /** Кому звонить. Пусто — записи без клиента или без телефона. */
  phone: string | null;
  /** Имя для шаблона SMS: только настоящее имя клиента, без «Без имени». */
  firstName: string;
  clientId: string | null;
  /** Команда визита — ею подписывают напоминание и открывают запись. */
  teamId: string | null;
  /** Время прошло, а статус остался «запланирована»: долг ли это, команда
   *  ещё не сказала (STORY-067). */
  unclosed: boolean;
}

export interface DebtWindow {
  from: string;
  to: string;
  /** Сегодня по часам компании: прошедшее считается несданным. */
  today: string;
  teamId: string | null;
  /** Записи, ушедшие под счёт: их деньги считает плитка «Документы», и здесь
   *  они были бы посчитаны второй раз. */
  invoicedAppointmentIds: ReadonlySet<string>;
}

export function debtRows(
  appointments: readonly Appointment[],
  clients: readonly { id: string; full_name: string; phone?: string | null }[],
  services: readonly { id: string; name: string }[],
  window: DebtWindow,
): DebtRow[] {
  const catalog = new Map(services.map((s) => [s.id, s.name]));
  const byId = new Map(clients.map((c) => [c.id, c]));

  return appointments
    .filter(
      (a) =>
        // ТОТ ЖЕ НАБОР, ЧТО В ПЛИТКЕ «ДОЛГИ»: завершённые визиты без оплаты
        // плюс прошедшие записи, по которым команда не отчиталась, МИНУС те,
        // на которые выставлен счёт.
        a.status !== "cancelled" &&
        (a.status === "completed" || a.date < window.today) &&
        a.date >= window.from &&
        a.date <= window.to &&
        (!window.teamId || a.team_id === window.teamId) &&
        !window.invoicedAppointmentIds.has(a.id),
    )
    .map((a): DebtRow => {
      const client = a.client_id ? byId.get(a.client_id) : undefined;
      return {
        key: a.id,
        appointmentId: a.id,
        title: client?.full_name || a.comment?.trim() || "Без имени",
        services: appointmentServiceNames(a, catalog),
        // Долг — деньги, которые ПРИДУТ: знак положительный, цвет янтарный
        // (владелец 2026-09-08 подтвердил янтарь: «долги это кто нам должен»).
        amount: getDebtAmount(a),
        date: a.date,
        // Возраст долга — главный признак срочности; дату не печатаем, она
        // стоит заголовком дня. Время визита живёт в строке услуг.
        time: a.time_start ? a.time_start.slice(0, 5) : null,
        caption: debtAge(a.date, window.today),
        count: 1,
        tone: "debt",
        phone: client?.phone?.trim() || null,
        firstName: (client?.full_name || "").trim().split(/\s+/)[0] ?? "",
        clientId: client?.id ?? null,
        teamId: a.team_id ?? null,
        unclosed: a.status !== "completed",
      };
    })
    .filter((r) => r.amount > 0)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}
