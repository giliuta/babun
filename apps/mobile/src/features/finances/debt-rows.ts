import {
  getDebtAmount,
  type Appointment,
} from "@babun/shared/local/appointments";
import {
  debtRemainderCents,
  DEBT_DIRECTION_LABEL,
  type Debt,
  type DebtDirection,
} from "@babun/shared/local/finance/debt";
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
  /** Куда поедут деньги. У долга записи всегда «мне должны»: работа сделана,
   *  клиент не заплатил. «Я должен» бывает только у ручного долга. */
  direction: DebtDirection;
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
        direction: "incoming",
      };
    })
    .filter((r) => r.amount > 0)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

// ─── РУЧНОЙ ДОЛГ ─────────────────────────────────────────────────────────────
// «Вася должен мне €100» без визита и «я должен Gree €900» за товар, взятый до
// оплаты. Одна и та же строка списка, что у долга записи: кто, за что, сколько
// и сколько дней висит. Разница ровно одна — вместо услуг визита стоит
// категория или заметка, потому что работы за этим долгом нет.

export function manualDebtRows(
  debts: readonly Debt[],
  paidTotals: ReadonlyMap<string, number>,
  refs: {
    clients: readonly { id: string; full_name: string; phone?: string | null }[];
    categories: readonly { id: string; name: string }[];
  },
  window: {
    today: string;
    direction?: DebtDirection;
    /** ОБЩАЯ ЛЕНТА СМЕШИВАЕТ СТОРОНЫ, и там «должны нам» и «должны мы»
     *  выглядели бы одинаково: обе строки янтарные и обе положительные.
     *  В разрезе «Долги» сторону называет переключатель, и отметка была бы
     *  повтором, — поэтому она включается, а не стоит всегда. */
    markDirection?: boolean;
  },
): DebtRow[] {
  const byId = new Map(refs.clients.map((c) => [c.id, c]));
  const categoryName = new Map(refs.categories.map((c) => [c.id, c.name]));

  return debts
    .filter((d) => !window.direction || d.direction === window.direction)
    .map((d): DebtRow => {
      const client = d.client_id ? byId.get(d.client_id) : undefined;
      // СУММА СТРОКИ — ОСТАТОК, А НЕ ИСХОДНЫЙ ДОЛГ. Долг на €900, по которому
      // отдали €300, — это €600 висящих денег; печатать €900 значит врать
      // и человеку, и плитке над списком.
      const remainder = debtRemainderCents(d.amount, paidTotals.get(d.id) ?? 0);
      const what = [
        window.markDirection && d.direction === "outgoing"
          ? DEBT_DIRECTION_LABEL.outgoing
          : "",
        categoryName.get(d.category_id ?? "") || d.note?.trim() || "",
      ]
        .filter(Boolean)
        .join(" · ");
      return {
        key: `debt-row:${d.id}`,
        debtId: d.id,
        // Записи за ручным долгом нет: тап открывает сам долг, а не визит.
        appointmentId: null,
        title: client?.full_name || d.counterparty,
        services: [],
        ...(what ? { subtitle: what } : {}),
        amount: remainder / 100,
        date: d.occurred_on,
        time: null,
        caption: debtAge(d.occurred_on, window.today),
        count: 1,
        tone: "debt",
        phone: client?.phone?.trim() || null,
        firstName: (client?.full_name || d.counterparty).trim().split(/\s+/)[0] ?? "",
        clientId: client?.id ?? null,
        teamId: d.team_id ?? null,
        // Ручной долг заводит человек, а не команда: отчитываться по нему
        // некому, и «не закрыт» тут не про статус визита.
        unclosed: false,
        direction: d.direction,
      };
    })
    // Закрытый долг уходит из списка САМ (владелец 2026-09-10: «я потом просто
    // буду удалять, если долг оплачен»). Удалять не нужно и вредно: пропала бы
    // история, кто и когда его закрыл, а в доход долг не попадал никогда —
    // в прибыль входит платёж по нему.
    .filter((r) => r.amount > 0);
}

/** Долги записей и ручные — один список, свежие сверху. Порядок общий, потому
 *  что для человека это один вопрос: кто и сколько мне должен. */
export function mergeDebtRows(
  fromRecords: readonly DebtRow[],
  manual: readonly DebtRow[],
): DebtRow[] {
  return [...fromRecords, ...manual].sort((a, b) => (a.date < b.date ? 1 : -1));
}
