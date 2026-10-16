// The recipient party: from the live client card or from the frozen snapshot.

import type { Client, Location } from "@babun/shared/local/clients";
import type {
  InvoiceClientSnapshot,
  InvoiceObjectAddressParts,
} from "@babun/shared/local/finance/invoice-ledger";
import type { InvoiceDictionary } from "../dictionary";
import { addressLines, clean, compact, firstNonEmpty, prefixed } from "./paper-text";
import type { DocumentParty } from "./types";

/** Получатель черновика — те же правила, что у снимка сервера
 *  (`build_invoice_client_snapshot_with_object`). */
export function clientParty(
  client: Client | undefined,
  location: Location | null,
  dict: InvoiceDictionary,
): DocumentParty {
  // Реквизиты клиента заводит карточка клиента; читаем их
  // структурно, чтобы бумага не зависела от того, когда поля лягут в тип.
  const requisites = client as
    | (Client & {
        legal_name?: string | null;
        vat_number?: string | null;
        reg_number?: string | null;
        billing_address?: string | null;
      })
    | undefined;
  return {
    name: firstNonEmpty(requisites?.legal_name, client?.full_name) || dict.recipientMissing,
    lines: compact([
      prefixed(dict.vatNo, clean(requisites?.vat_number)),
      prefixed(dict.regNumber, clean(requisites?.reg_number)),
      clean(client?.email),
      ...addressLines(clean(requisites?.billing_address)),
      ...(hasExactAddress(location?.addressParts)
        ? objectAddressLines(location?.addressParts ?? null, dict)
        : []),
    ]),
  };
}

/** ПОЛУЧАТЕЛЬ ИЗ СНИМКА — одна вёрстка на инвойс и чек:
 *  юрназвание или имя, номера, почта, юрадрес
 *  реквизитов, точный адрес объекта. Снимок старше объектов печатает свой
 *  адрес как раньше. */
export function clientSnapshotParty(
  recipient: Partial<InvoiceClientSnapshot>,
  dict: InvoiceDictionary,
): DocumentParty {
  return {
    name: firstNonEmpty(recipient.legal_name, recipient.full_name) || dict.recipientMissing,
    lines: compact([
      prefixed(dict.vatNo, clean(recipient.vat_number)),
      prefixed(dict.regNumber, clean(recipient.reg_number)),
      clean(recipient.email),
      ...(recipient.object === undefined
        ? addressLines(firstNonEmpty(recipient.primary_address, recipient.address))
        : [
            ...addressLines(clean(recipient.billing_address)),
            ...objectAddressLines(recipient.object?.address_parts, dict),
          ]),
    ]),
  };
}

/** АДРЕС НА ИНВОЙС — ТОЛЬКО ИЗ «ТОЧНОГО АДРЕСА»: если пишем в точный адрес —
 *  в инвойсе адрес есть, а обычный адрес не выставляется. Главная строка
 *  объекта хранится как `street`; адрес
 *  печатается, когда заполнено хоть одно поле блока «Точный адрес». То же
 *  правило у сервера (`invoice_object_snapshot`, миграция 20260922090000). */
export function hasExactAddress(
  parts: InvoiceObjectAddressParts | null | undefined,
): boolean {
  return (["complex", "entrance", "floor", "apartment", "city", "zip"] as const)
    .some((key) => clean(parts?.[key]) !== "");
}

/** ТОЧНЫЙ АДРЕС ОБЪЕКТА строками бумаги: «Makariou 12, Sunny Court» /
 *  «Floor 3, Apt 5» / «Limassol 4000». Без «где» (улицы, комплекса или
 *  города) адреса нет вовсе — как у сервера: «эт. 3, кв. 5» никуда не ведёт. */
export function objectAddressLines(
  parts: InvoiceObjectAddressParts | null | undefined,
  dict: InvoiceDictionary,
): string[] {
  const part = (key: keyof InvoiceObjectAddressParts) => clean(parts?.[key]);
  if (!part("street") && !part("complex") && !part("city")) return [];
  return compact([
    [part("street"), part("complex")].filter(Boolean).join(", "),
    [
      part("entrance") ? dict.addrEntrance(part("entrance")) : "",
      part("floor") ? dict.addrFloor(part("floor")) : "",
      part("apartment") ? dict.addrApartment(part("apartment")) : "",
    ].filter(Boolean).join(", "),
    [part("city"), part("zip")].filter(Boolean).join(" "),
  ]);
}
