// Ledger transactions -> feed rows: one row per visit, invoice or transfer.

import type { Appointment } from "@babun/shared/local/appointments";
import {
  signedAmount,
  type FinanceTransaction,
} from "@babun/shared/local/finance/transaction";
import { payeeName, withPayee } from "../category-asks";
import type { RecordRow, RecordRowRefs, RowAccount } from "./types";

/** Имена услуг визита. Снимок в записи сильнее каталога: услугу могли
 *  переименовать или удалить, а на бумаге визита осталось имя того дня. */
export function appointmentServiceNames(
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
  const account = new Map((refs.accounts ?? []).map((a) => [a.id, a.name]));
  const accountRank = new Map((refs.accounts ?? []).map((a, i) => [a.id, i]));
  const invoiceNumber = new Map((refs.invoices ?? []).map((i) => [i.id, i.number]));
  /** Счета строки по id проводок. Неизвестный счёт молчит: печатать «счёт»
   *  рядом с услугами — сказать меньше, чем ничего. */
  const accountTags = (
    ids: Iterable<string | null>,
  ): RowAccount[] | undefined => {
    const tags: RowAccount[] = [];
    for (const id of ids) {
      const name = id ? account.get(id) : undefined;
      const rank = id ? accountRank.get(id) : undefined;
      if (name !== undefined && rank !== undefined) tags.push({ name, rank });
    }
    return tags.length > 0 ? tags : undefined;
  };

  const byRecord = new Map<string, RecordRow>();
  /** Оплаты одного инвойса — одной строкой, как платежи одной записи. */
  const byInvoice = new Map<string, RecordRow>();
  const invoiceAccounts = new Map<string, Set<string | null>>();
  /** Счета визита копятся по мере сложения его проводок. */
  const recordAccounts = new Map<string, Set<string | null>>();
  const rows: RecordRow[] = [];

  // ПЕРЕВОД — ОДНА ОПЕРАЦИЯ, А НЕ ДВЕ. В леджере он лежит парой строк —
  // минус на одном счёте, плюс на другом, — и лента печатала обе. Для человека
  // это одно движение: столько-то денег переехало отсюда туда.
  //
  // Склеиваем ТОЛЬКО когда обе ноги в срезе. Одна нога значит, что вторая
  // осталась за границей команды или счёта, и печатать её без знака —
  // спрятать, что деньги из этого среза ушли.
  const legs = new Map<string, FinanceTransaction[]>();
  for (const tx of transactions) {
    if (tx.type !== "transfer" || !tx.transfer_group_id) continue;
    const group = legs.get(tx.transfer_group_id);
    if (group) group.push(tx);
    else legs.set(tx.transfer_group_id, [tx]);
  }
  const paired = new Set<string>();
  for (const [groupId, group] of legs) {
    const out = group.find((tx) => tx.amount < 0);
    const into = group.find((tx) => tx.amount > 0);
    if (!out || !into) continue;
    for (const tx of group) paired.add(tx.id);
    const name = (id: string | null) =>
      (id ? account.get(id) : null) ?? "счёт";
    rows.push({
      key: `transfer:${groupId}`,
      appointmentId: null,
      txId: out.id,
      title: "Перевод",
      services: [],
      subtitle: `${name(out.account_id)} → ${name(into.account_id)}`,
      // Знака нет: деньги не пришли и не ушли, они переехали. Минус читался
      // бы как расход, плюс — как доход, а для прибыли перевод нейтрален.
      amount: Math.abs(out.amount),
      tone: "transfer",
      date: out.occurred_on,
      time: out.occurred_time,
      // Ног у перевода две, а перевод ОДИН: «2 платежа» под ним читалось как
      // два движения денег.
      count: 1,
    });
  }

  for (const tx of transactions) {
    if (paired.has(tx.id)) continue;
    const apt = tx.appointment_id ? appointment.get(tx.appointment_id) : null;
    // ДЕНЬГИ ПО ИНВОЙСУ — СТРОКОЙ ИНВОЙСА: кто заплатил и «Инвойс INV-…»,
    // тап открывает инвойс (как неоплаченный в «Долгах»).
    const invNumber = tx.invoice_id ? invoiceNumber.get(tx.invoice_id) : undefined;
    if (tx.invoice_id && invNumber) {
      const seen = byInvoice.get(tx.invoice_id);
      if (seen) {
        seen.amount += signedAmount(tx);
        seen.count += 1;
        invoiceAccounts.get(tx.invoice_id)?.add(tx.account_id);
        if (tx.occurred_on > seen.date) {
          seen.date = tx.occurred_on;
          seen.time = tx.occurred_time;
        }
        continue;
      }
      const clientId = tx.client_id ?? apt?.client_id ?? null;
      const row: RecordRow = {
        key: `invoice:${tx.invoice_id}`,
        appointmentId: null,
        invoiceId: tx.invoice_id,
        // Номер — заголовком: во второй строке после счёта он обрезался
        // («Наличные · Инвойс INV-2026-0…»). Кто заплатил — второй строкой.
        title: `Инвойс ${invNumber}`,
        services: [],
        subtitle: (clientId ? client.get(clientId) : null) || "Без клиента",
        amount: signedAmount(tx),
        date: tx.occurred_on,
        time: tx.occurred_time,
        count: 1,
      };
      byInvoice.set(tx.invoice_id, row);
      invoiceAccounts.set(tx.invoice_id, new Set([tx.account_id]));
      rows.push(row);
      continue;
    }
    // Проводка ссылается на запись, которой нет в окне периода (визит в
    // прошлом месяце, деньги в этом). Складывать её не с чем — печатаем как
    // одиночную, иначе строка потеряется вовсе.
    if (!apt) {
      const note = tx.notes?.trim() || undefined;
      // Перевод НЕ отдаёт заголовок заметке: «на бензин −€50» без слова
      // «Перевод» неотличим от расхода, хотя для прибыли строка нейтральна
      // (тот же закон, что в ленте операций).
      const categoryName = tx.category_id ? category.get(tx.category_id) : null;
      const title =
        tx.type === "transfer"
          ? "Перевод"
          : categoryName
            ? withPayee(
                categoryName,
                // Сотрудник важнее: у чаевых оба, а строка про того, кому
                // достались деньги. Нет сотрудника — клиент операции.
                payeeName(refs.people, tx.master_id) ??
                  (tx.client_id ? client.get(tx.client_id) : null),
              )
            : note || "Операция";
      rows.push({
        key: tx.id,
        appointmentId: null,
        txId: tx.id,
        title,
        services: [],
        // Заметку печатаем, только если она не повторяет заголовок: у
        // операции без категории заголовком стала сама заметка. Счёт идёт
        // своим полем и встаёт после заметки, а не вместо неё.
        subtitle: note && note !== title ? note : undefined,
        accounts: accountTags([tx.account_id]),
        tone: tx.type === "transfer" ? "transfer" : undefined,
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
      recordAccounts.get(apt.id)?.add(tx.account_id);
      // Визит вне периода: строка — в последний день денег.
      if (existing.forDay && tx.occurred_on > existing.date) {
        existing.date = tx.occurred_on;
        existing.time = tx.occurred_time;
      }
      continue;
    }
    recordAccounts.set(apt.id, new Set([tx.account_id]));
    const outside =
      !!refs.window && (apt.date < refs.window.from || apt.date > refs.window.to);
    const row: RecordRow = {
      key: apt.id,
      appointmentId: apt.id,
      title:
        (apt.client_id ? client.get(apt.client_id) : null) || "Без клиента",
      services: appointmentServiceNames(apt, catalog),
      amount: signedAmount(tx),
      // Время визита, а не проводки: деньги по записи могли записать вечером,
      // но в списке работ строка стоит там, где стояла работа. Работа вне
      // периода ленты — строка стоит днём денег и называет день работы.
      date: outside ? tx.occurred_on : apt.date,
      time: outside
        ? tx.occurred_time
        : apt.time_start
          ? apt.time_start.slice(0, 5)
          : tx.occurred_time,
      ...(outside ? { forDay: apt.date } : {}),
      count: 1,
    };
    byRecord.set(apt.id, row);
    rows.push(row);
  }

  for (const [aptId, ids] of recordAccounts) {
    const row = byRecord.get(aptId);
    if (row) row.accounts = accountTags(ids);
  }
  for (const [invoiceId, ids] of invoiceAccounts) {
    const row = byInvoice.get(invoiceId);
    if (row) row.accounts = accountTags(ids);
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
