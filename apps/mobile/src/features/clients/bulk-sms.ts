// bulk-sms — build the sms: deep-links for a bulk SMS blast (mobile
// bulk-mode). NOTHING is sent from here: iOS/Android only expose the sms:
// URL scheme, which opens the system Messages composer pre-filled — the
// operator taps Send there. That's the same contract the card «SMS о долге»
// action and the web BulkSmsSheet honour (see card-actions.tsx / web
// page.tsx BulkSmsSheet).
//
// The `[Имя]` problem — a single `sms:num1,num2?body=…` link (the web's
// approach) can carry ONE body to many numbers, but a per-recipient name
// cannot be baked into a shared body. So we split the two intents:
//
//   • «Каждому по имени» → SEQUENTIAL. One sms: link per recipient with the
//     template rendered against THAT client's name. The composer opens for
//     the first; on return the caller advances to the next. This is the only
//     way to get [Имя] right per person natively.
//
//   • «Всем сразу» → SINGLE comma-link (num1,num2,…) with ONE shared body.
//     Offered only when the body has no [Имя] token, so the operator never
//     silently loses the name.
//
// A bulk blast knows two fields per recipient: [Имя] and [Компания]. Visit
// fields ([Дата], [Время], [Ссылка]…) and the debt have no value here, and
// cutting them out gave the client «Анна, ждём вас в .». So the text follows
// the same rule as every other SMS (`fillTemplate`): a field without a value
// means the text is not sent — the sheet says why instead.
//
// Platform sep (`smsUrlWithBody`): iOS uses `&body=`, Android `?body=`. The
// OS comes in as an argument so the module stays free of react-native.

import type { Client } from "@babun/shared/local/clients";
import { templateTokenKeys } from "@babun/shared/local/sms-templates";
import { fillTemplate, fitsSmsLimit, MAX_SMS_PARTS, smsUrlWithBody, smsVars } from "@/features/sms/sms-compose";
import { addressedAs, firstName } from "@/lib/sms-name";

/** Dialable phone for the sms: address. Prefers the canonical E.164
 *  (phone_e164) so a locally-typed number without a country code still
 *  carries its «+код» into the composer — falling back to the raw phone
 *  only when no E.164 was resolved. The leading «+» is kept (the sms:
 *  scheme accepts it and it disambiguates international numbers); other
 *  non-digits are stripped. Empty when the client has no number. */
export function smsDigits(client: Client): string {
  const e164 = (client.phone_e164 ?? "").trim();
  if (e164) return e164.replace(/[^\d+]/g, "");
  return (client.phone ?? "").replace(/\D/g, "");
}

/** True when the template body carries a [Имя]/[Name] token — then a
 *  single all-at-once blast would drop the personalisation and we must
 *  fall back to sequential. */
export function bodyHasNameToken(body: string): boolean {
  return /\[(Имя|Name)\]/u.test(body);
}

/** The only fields a bulk blast can fill. */
const BULK_FIELDS: ReadonlySet<string> = new Set(["Name", "Company"]);

/** True when every field of the body is one a bulk blast can fill — only
 *  such templates are offered in the sheet. */
export function bulkFillable(body: string): boolean {
  return templateTokenKeys(body).every((key) => BULK_FIELDS.has(key));
}

/** The ready text for one recipient: [Имя] — the client's «Имя для SMS» (or
 *  the first word of the name), [Компания] — the company. `null` when the
 *  text does not fill completely (a visit field, a name of only emoji): such
 *  a recipient gets nothing rather than a text with a hole in it. Same text
 *  for the phone composer and for sending through the service. */
export function bulkBodyFor(body: string, client: Client, company: string | null): string | null {
  return fillTemplate(body, smsVars({ name: addressedAs(client, firstName(client)), company }));
}

/** Why the blast cannot go, or `null`. Shown under the text field; the send
 *  buttons are off while it is there. */
export function bulkProblem(body: string, clients: readonly Client[], company: string | null): string | null {
  if (!body.trim()) return null;
  if (!bulkFillable(body)) return "В рассылке есть только [Имя] и [Компания] — уберите другие поля";
  const tooLong = clients.some((c) => {
    const text = bulkBodyFor(body, c, company);
    return text !== null && !fitsSmsLimit(text);
  });
  if (tooLong) return `С подставленными именами текст длиннее ${MAX_SMS_PARTS} SMS — сократите его`;
  return null;
}

/** Build the SEQUENTIAL plan — one { client, url } per dialable recipient,
 *  each body personalised. Recipients without a phone, or whose text does
 *  not fill, are skipped. */
export function buildSequentialSms(
  body: string,
  clients: readonly Client[],
  company: string | null,
  os: string,
): { client: Client; url: string }[] {
  const out: { client: Client; url: string }[] = [];
  for (const c of clients) {
    const digits = smsDigits(c);
    const text = digits ? bulkBodyFor(body, c, company) : null;
    if (text) out.push({ client: c, url: smsUrlWithBody(`sms:${digits}`, text, os) });
  }
  return out;
}

/** Build the SINGLE all-at-once link — comma-joined numbers, ONE shared
 *  body. Returns null when no recipient has a phone or the body has a field
 *  the blast cannot fill (the [Имя] case is refused by the sheet). */
export function buildBlastSms(
  body: string,
  clients: readonly Client[],
  company: string | null,
  os: string,
): { url: string; recipients: number } | null {
  const digits = clients.map(smsDigits).filter((d) => d.length > 0);
  if (digits.length === 0) return null;
  const text = fillTemplate(body, smsVars({ company }));
  if (!text) return null;
  return { url: smsUrlWithBody(`sms:${digits.join(",")}`, text, os), recipients: digits.length };
}
