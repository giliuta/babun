import type { CountryCode } from "libphonenumber-js";
import type { PhoneEntry } from "@babun/shared/local/clients";
import { phoneKey } from "@/features/clients/merge-clients";
import { EXTRA_LABELS, OTHER_LABEL } from "@/features/clients/extra-contacts/extra-labels";
import { formatPhoneAsYouType, tryToE164 } from "@/lib/phone";

// КОНТАКТ ТЕЛЕФОНА → СТРОКА ИМПОРТА.
//
// - Контакт без номера тоже клиент: «можно написать имя и уже сохранять»
//   (телефон необязателен). Ключ такой строки — id контакта.
// - «Уже есть» — по ЛЮБОМУ номеру контакта: первый номер мог быть новым, а
//   второй — уже у клиента, и контакт заводился дублем.
// - Номера переносятся ВСЕ: первый разобранный — основным, остальные — «Телефон N».
// - Номер, который не разбирается по стране команды (5555648583 у кипрской
//   команды), не становится основным: у основного номера есть ключ дубля, а у
//   такого его нет. Он едет доп. номером — человек увидит и поправит.

export interface ContactLike {
  id?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  phoneNumbers?: { number?: string }[];
}

export interface ContactRow {
  key: string;
  name: string;
  /** Основной номер в общем виде; пусто — основного нет. */
  phone: string;
  phoneE164: string | null;
  /** Остальные номера контакта — в `phones` клиента (id ставит импорт). */
  extras: Omit<PhoneEntry, "id">[];
  /** Уже есть в базе — показываем, но не даём выбрать. */
  exists: boolean;
}

export function contactRows(
  contacts: readonly ContactLike[],
  country: CountryCode,
  known: ReadonlySet<string>,
): ContactRow[] {
  const seen = new Set<string>();
  const rows: ContactRow[] = [];
  contacts.forEach((c, index) => {
    const numbers = (c.phoneNumbers ?? [])
      .map((p) => (p.number ?? "").trim())
      .filter(Boolean);
    const keys = numbers.map((n) => phoneKey(n, country)).filter((k) => k.length >= 5);
    const mainIndex = numbers.findIndex((n) => tryToE164(n, country) !== null);
    const main = mainIndex >= 0 ? numbers[mainIndex] : "";
    const key = keys[0] ?? `contact:${c.id ?? index}`;
    if (seen.has(key)) return;
    seen.add(key);
    const name =
      c.name?.trim() ||
      [c.firstName, c.lastName].filter(Boolean).join(" ").trim() ||
      (main ? formatPhoneAsYouType(main, country) : numbers[0] ?? "");
    if (!name) return;
    const rest = numbers.filter((_, i) => i !== mainIndex);
    rows.push({
      key,
      name,
      phone: main ? formatPhoneAsYouType(main, country) : "",
      phoneE164: main ? tryToE164(main, country) : null,
      extras: rest.map((n, i) => ({
        number: tryToE164(n, country) ? formatPhoneAsYouType(n, country) : n,
        label: EXTRA_LABELS[i] ?? OTHER_LABEL,
      })),
      exists: keys.some((k) => known.has(k)),
    });
  });
  return rows.sort((a, b) => a.name.localeCompare(b.name, "ru"));
}
