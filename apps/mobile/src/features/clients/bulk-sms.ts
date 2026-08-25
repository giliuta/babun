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
//   • «Всем сразу» → SINGLE comma-link (num1,num2,…) with the body rendered
//     WITHOUT a name (the template's [Имя] is stripped to a neutral form).
//     One composer, all recipients — fast, but generic. Offered only when the
//     body has no [Имя] token, so the operator never silently loses the name.
//
// Platform sep: iOS uses `&body=`, Android `?body=` after the address list.

import { Platform } from "react-native";
import type { Client } from "@babun/shared/local/clients";
import { renderTemplate } from "@babun/shared/local/sms-templates";

/** First word of the full name — what [Имя] resolves to in a greeting. */
export function firstName(client: Client): string {
  return (client.full_name || "").trim().split(/\s+/)[0] ?? "";
}

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

function bodySep(): string {
  return Platform.OS === "ios" ? "&" : "?";
}

/** Strip any [Токен] left after rendering and tidy the whitespace it left
 *  behind. In a bulk blast the only token we can resolve is [Имя]/[Name];
 *  a chosen template may still carry [Сумма]/[Цена]/[Дата]/… which have no
 *  per-recipient value here. Rather than send the literal «[Сумма]» text we
 *  drop the placeholder (same intent as collapsing an empty name). */
function stripUnresolvedTokens(text: string): string {
  return text
    .replace(/\[[\p{L}\p{N}_]+\]/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Render `body` for one client (fills [Имя]) and return its sms: URL, or
 *  null if the client has no phone. */
function smsUrlForClient(body: string, client: Client): string | null {
  const digits = smsDigits(client);
  if (!digits) return null;
  const rendered = renderTemplate(body, {
    Name: firstName(client),
    Имя: firstName(client),
  });
  const text = stripUnresolvedTokens(rendered);
  return `sms:${digits}${bodySep()}body=${encodeURIComponent(text)}`;
}

/** Build the SEQUENTIAL plan — one { client, url } per dialable recipient,
 *  each body personalised. Recipients without a phone are skipped. */
export function buildSequentialSms(
  body: string,
  clients: readonly Client[],
): { client: Client; url: string }[] {
  const out: { client: Client; url: string }[] = [];
  for (const c of clients) {
    const url = smsUrlForClient(body, c);
    if (url) out.push({ client: c, url });
  }
  return out;
}

/** Build the SINGLE all-at-once link — comma-joined numbers, ONE shared
 *  body (rendered with an empty name so a stray [Имя] collapses cleanly).
 *  Returns null when no recipient has a phone. */
export function buildBlastSms(
  body: string,
  clients: readonly Client[],
): { url: string; recipients: number } | null {
  const digits = clients.map(smsDigits).filter((d) => d.length > 0);
  if (digits.length === 0) return null;
  // Render with an empty name so a stray [Имя] collapses, then drop any
  // OTHER unresolved token ([Сумма]/[Цена]/…) that has no bulk value.
  const text = stripUnresolvedTokens(renderTemplate(body, { Name: "", Имя: "" }));
  const url = `sms:${digits.join(",")}${bodySep()}body=${encodeURIComponent(text)}`;
  return { url, recipients: digits.length };
}
