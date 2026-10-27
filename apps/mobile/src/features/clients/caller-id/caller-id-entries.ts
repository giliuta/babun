import type { Client } from "@babun/shared/local/clients";
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import { DEFAULT_COUNTRY, tryToE164 } from "@/lib/phone";

// СПИСОК ДЛЯ ОПРЕДЕЛИТЕЛЯ НОМЕРА (Call Directory Extension на iPhone).
//
// CallKit принимает номер как целое `CXCallDirectoryPhoneNumber` — цифры
// E.164 без «+» — и требует, чтобы номера шли СТРОГО ПО ВОЗРАСТАНИЮ и без
// повторов: иначе вся загрузка падает ошибкой `entriesOutOfOrder` /
// `duplicateEntries`, и телефон не подписывает ни одного звонка. Поэтому
// порядок и уникальность собираются здесь, в чистой функции под тестом, а
// расширение только читает готовый файл.
//
// Цифры E.164 не начинаются с нуля, поэтому порядок «короче — раньше, при
// равной длине — по строке» совпадает с числовым и не требует BigInt.

export interface CallerIdEntry {
  /** Цифры E.164 без «+»: «35799123456». */
  number: string;
  /** Подпись на экране звонка: «Andreas Georgiou · Limassol · Babun». */
  label: string;
}

const BRAND = "Babun";
const SEP = " · ";
// Экран звонка режет длинную подпись хвостом; имя важнее города, поэтому
// город — первое, что уступает место.
const MAX_LABEL = 48;
const E164_DIGITS = /^[1-9]\d{6,14}$/;

/** Цифры номера в E.164 или `null`, если номер не разобрать (тем же
 *  разбором, что ключ дублей `phone_e164`). Номер без кода страны
 *  дополняется кодом страны основного номера клиента. */
function e164Digits(raw: string | null | undefined, country: CountryCode): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const digits = (tryToE164(value, country) ?? "").replace(/^\+/, "");
  return E164_DIGITS.test(digits) ? digits : null;
}

function countryOf(e164: string | null, fallback: CountryCode): CountryCode {
  if (!e164) return fallback;
  return parsePhoneNumberFromString(`+${e164}`)?.country ?? fallback;
}

function labelFor(name: string, city: string): string {
  const withCity = city ? [name, city, BRAND].join(SEP) : "";
  if (withCity && withCity.length <= MAX_LABEL) return withCity;
  const tail = SEP + BRAND;
  const room = MAX_LABEL - tail.length;
  const short = name.length > room ? `${name.slice(0, room - 1).trimEnd()}…` : name;
  return short + tail;
}

/** Числовой порядок цифр E.164 (см. шапку файла). */
export function compareE164Digits(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Номера клиентов для определителя: основной номер и дополнительные,
 *  отсортированные и без повторов. Номер, стоящий у нескольких карточек,
 *  подписывается первой по алфавиту — один номер, одна подпись. Клиенты из
 *  корзины и строки без номера не попадают. */
export function buildCallerIdEntries(
  clients: readonly Client[],
  defaultCountry: CountryCode = DEFAULT_COUNTRY,
): CallerIdEntry[] {
  const byNumber = new Map<string, { name: string; label: string }>();
  const offer = (digits: string | null, name: string, label: string) => {
    if (!digits) return;
    const taken = byNumber.get(digits);
    if (taken && taken.name.localeCompare(name) <= 0) return;
    byNumber.set(digits, { name, label });
  };

  for (const client of clients) {
    if (client.deleted_at) continue;
    const name = client.full_name.trim();
    if (!name) continue;
    const city = (client.city ?? "").trim();
    const primary =
      e164Digits(client.phone_e164, defaultCountry) ?? e164Digits(client.phone, defaultCountry);
    offer(primary, name, labelFor(name, city));
    const country = countryOf(primary, defaultCountry);
    for (const extra of client.phones ?? []) {
      const who = (extra.name ?? "").trim();
      const extraName = who ? `${who}${SEP}${name}` : name;
      offer(e164Digits(extra.number, country), extraName, labelFor(extraName, city));
    }
  }

  return [...byNumber.entries()]
    .sort(([a], [b]) => compareE164Digits(a, b))
    .map(([number, { label }]) => ({ number, label }));
}

/** Файл для расширения: строка на номер, «цифры<TAB>подпись». Табуляция и
 *  перевод строки в имени заменяются пробелом — иначе одна запись разъехалась
 *  бы на две. */
export function serializeCallerIdEntries(entries: readonly CallerIdEntry[]): string {
  return entries
    .map(({ number, label }) => `${number}\t${label.replace(/[\t\r\n]+/g, " ")}`)
    .join("\n");
}
