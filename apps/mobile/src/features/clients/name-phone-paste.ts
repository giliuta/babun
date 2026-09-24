import type { CountryCode } from "libphonenumber-js";
import { formatPhoneAsYouType, tryToE164 } from "./phone";

// «МАРИЯ +357 99 123456» В ПОЛЕ ИМЕНИ НОВОГО КЛИЕНТА.
//
// Контакт из WhatsApp копируют целиком — имя и номер одной строкой — и
// вставляют в первое поле, где стоит курсор, а это имя. Раньше клиент так и
// создавался «Мария +357 99 123456» с пустым телефоном. Теперь черновик
// делит вставку: номер уходит в поле телефона, в имени остаётся имя.
//
// НОМЕР РЕШАЕТ `tryToE164` — та же функция, которой разбирается поле
// телефона и строится ключ дедупа. Регулярка ниже только НАХОДИТ отрезки,
// похожие на номер (цифры с «+», пробелами, скобками, дефисами); годится ли
// отрезок, решает разбор. Не разобрался ни один — вставка не трогается.

/** Невидимые знаки направления: WhatsApp оборачивает ими номер при копировании
 *  («‪+357 99 123456‬»), и в имени они остались бы мусором. */
const BIDI_MARKS = /[‎‏‪-‮⁦-⁩]/g;

/** Отрезок, похожий на номер: не короче семи знаков, начинается «+» или
 *  цифрой и кончается цифрой. */
const CANDIDATE = /\+?\d[\d\s().-]{5,}\d/g;

/** Знаки между именем и номером, которые после выреза номера висят по краям
 *  («Мария – +357…», «Мария, +357…», «Мария: +357…»). */
const EDGE_JUNK = /^[\s,;:|/–—-]+|[\s,;:|/–—-]+$/g;

export interface NamePhoneSplit {
  /** Имя без номера. */
  name: string;
  /** Номер в виде, каким его показывает поле телефона («+357 99 123456»). */
  phone: string;
  /** Канонический E.164 — ключ дедупа. */
  e164: string;
}

/** Разделить «имя + номер». `null` — номера в тексте нет (или имени без него
 *  не остаётся): тогда текст — просто имя, и трогать его нельзя. */
export function splitNameAndPhone(
  raw: string,
  country: CountryCode,
): NamePhoneSplit | null {
  const text = (raw ?? "").replace(BIDI_MARKS, "");
  for (const match of text.matchAll(CANDIDATE)) {
    const candidate = match[0];
    const e164 = tryToE164(candidate, country);
    if (!e164) continue;
    const at = match.index ?? 0;
    const name = `${text.slice(0, at)} ${text.slice(at + candidate.length)}`
      .replace(/\s+/g, " ")
      .replace(EDGE_JUNK, "")
      .trim();
    if (!name) return null;
    // Второй номер в остатке — это уже не «имя + номер», а два контакта
    // одной вставкой. Какой из них чей, не угадать: не трогаем ничего.
    for (const rest of name.matchAll(CANDIDATE)) {
      if (tryToE164(rest[0], country)) return null;
    }
    return { name, phone: formatPhoneAsYouType(e164, country), e164 };
  }
  return null;
}
