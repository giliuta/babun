import type { Appointment } from "@babun/shared/local/appointments";
import type { Client } from "@babun/shared/local/clients";

import { clientBlockLevel } from "./client-block-access";

// «ИСТОРИЯ ЗАПИСЕЙ» КЛИЕНТА У СОТРУДНИКА (проверка глазами 01.10).
//
// Карточка и строка списка считают визиты по записям, а у сотрудника записи
// приходят из его календаря: клиент записи открыт там только правом «Клиент
// в записи» и только около записи. С открытой «Историей записей» у всех
// клиентов было «нет записей». Теперь историю отдаёт своя дверь сервера
// (`member_client_history`), а здесь — её склейка с календарём и та же маска
// для «Посмотреть его глазами», где читает токен владельца.

/** Календарь + история: строка календаря с клиентом главнее (в ней больше
 *  полей), строка без клиента (клиент скрыт окном) уступает строке истории. */
export function withClientHistory(
  calendar: readonly Appointment[],
  history: readonly Appointment[],
): Appointment[] {
  if (history.length === 0) return [...calendar];
  const out = [...calendar];
  const at = new Map(out.map((row, index) => [row.id, index]));
  for (const row of history) {
    const index = at.get(row.id);
    if (index === undefined) {
      at.set(row.id, out.length);
      out.push(row);
    } else if (!out[index].client_id) {
      out[index] = row;
    }
  }
  return out;
}

/** Строка истории, какой её отдал бы сервер: суммы — при «Долг и деньги»,
 *  объект — при «Объекты», заметки и адреса записи — никогда. */
export function maskHistoryRow(row: Appointment, client: Pick<Client, "blocks">): Appointment {
  const money = clientBlockLevel(client, "clients.money") !== "hidden";
  const objects = clientBlockLevel(client, "clients.objects") !== "hidden";
  return {
    ...row,
    location_id: objects ? row.location_id : null,
    comment: "",
    address: "",
    address_note: "",
    address_lat: null,
    address_lng: null,
    city: null,
    cancel_reason: null,
    color_override: null,
    photos: [],
    expenses: [],
    payments: [],
    payment: null,
    prepaid_amount: 0,
    total_amount: money ? row.total_amount : 0,
    custom_total: money ? row.custom_total : false,
    discount_amount: money ? row.discount_amount : 0,
    paid_amount: money ? row.paid_amount : 0,
    payment_status: money ? row.payment_status : "unpaid",
    services: money
      ? row.services
      : row.services.map((line) => ({
          ...line,
          pricePerUnit: 0,
          originalPrice: 0,
          totalPrice: 0,
          discount: undefined,
        })),
    service_price_overrides: {},
    global_discount: null,
  };
}

/** «Его глазами»: из всех записей компании (токен владельца) — история
 *  клиентов из его набора, у которых «История записей» открыта. */
export function mirrorHistory(
  all: readonly Appointment[],
  clients: ReadonlyMap<string, Pick<Client, "blocks">>,
): Appointment[] {
  const out: Appointment[] = [];
  for (const row of all) {
    if (row.kind !== "work" || !row.client_id) continue;
    const client = clients.get(row.client_id);
    if (!client || clientBlockLevel(client, "clients.history") === "hidden") continue;
    out.push(maskHistoryRow(row, client));
  }
  return out;
}
