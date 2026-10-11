// ЧТО ПЕЧАТАЕТ КАРТА ЧЕЛОВЕКА сверху Кабинета.
//
// Имя — `user_metadata.full_name` (пишется при регистрации и правится в
// «Профиле»), телефон — `user_metadata.phone` (сам человек его вписал, не
// подтверждён), день рождения — `user_metadata.birthday` («YYYY-MM-DD»),
// почта — логин аккаунта. У старых аккаунтов имени нет: тогда на месте имени
// стоит почта, а второй раз её не печатаем.
//
// КАРТА — ПОЛНАЯ ВИЗИТКА (владелец 06.10: «имя, имя компании, почта, номер,
// дата рождения — чтобы в шапке была чёткая информация»). Под именем —
// компания (имя своего аккаунта), ниже — факты значком и значением, без
// подписей: значок и есть подпись. Пустое не печатается.

import { formatPhoneForDisplay } from "../clients/phone";

export type PersonFactKind = "email" | "phone" | "birthday";

export interface PersonFact {
  kind: PersonFactKind;
  text: string;
}

export type PersonCardView = {
  title: string;
  /** Имя своего аккаунта — когда оно не повторяет имя человека. */
  company: string | null;
  facts: PersonFact[];
  initials: string;
};

type UserLike =
  | {
      email?: string | null;
      user_metadata?: Record<string, unknown> | null;
    }
  | null
  | undefined;

const clean = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

export function personCardView(user: UserLike, accountName?: string | null): PersonCardView {
  const name = clean(user?.user_metadata?.full_name);
  const email = clean(user?.email);
  const phone = clean(user?.user_metadata?.phone);
  const birthday = birthdayText(clean(user?.user_metadata?.birthday));
  const title = name || email || "Аккаунт";
  const account = clean(accountName);
  // Регистрация кладёт одно поле «Имя или название компании» и в имя, и в
  // аккаунт — пока их не развели в «Профиле», второй раз то же слово не
  // печатаем.
  const company =
    account && account.toLocaleLowerCase() !== title.toLocaleLowerCase() ? account : null;
  const facts: PersonFact[] = [];
  if (name && email) facts.push({ kind: "email", text: email });
  if (phone) facts.push({ kind: "phone", text: formatPhoneForDisplay(phone) });
  if (birthday) facts.push({ kind: "birthday", text: birthday });
  return { title, company, facts, initials: initialsOf(name, title) };
}

/** «1990-03-12» → «12 марта 1990»; кривое — пусто. Месяц словом языка
 *  интерфейса: `ru-RU` при сборке заменяется языком телефона. */
export function birthdayText(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return "";
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return "";
  const dayMonth = date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  return `${dayMonth} ${y}`;
}

/** Две первые буквы имени («Артём Гилюта» → «АГ»); без имени — первая буква
 *  того, что стоит на месте имени. `Array.from` — чтобы не резать пополам
 *  символ за пределами BMP. */
function initialsOf(name: string, fallback: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  const letters =
    words.length > 0
      ? words.slice(0, 2).map((word) => Array.from(word)[0] ?? "")
      : [Array.from(fallback)[0] ?? ""];
  return letters.join("").toUpperCase() || "?";
}
