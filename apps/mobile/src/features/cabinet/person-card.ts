// ЧТО ПЕЧАТАЕТ КАРТА ЧЕЛОВЕКА сверху Кабинета.
//
// Имя — `user_metadata.full_name` (пишется при регистрации и правится в
// «Профиле»), телефон — `user_metadata.phone` (сам человек его вписал, не
// подтверждён), почта — логин аккаунта. У старых аккаунтов имени нет: тогда на
// месте имени стоит почта, а второй раз её не печатаем.

export type PersonCardView = {
  title: string;
  lines: string[];
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

export function personCardView(user: UserLike): PersonCardView {
  const name = clean(user?.user_metadata?.full_name);
  const email = clean(user?.email);
  const phone = clean(user?.user_metadata?.phone);
  const title = name || email || "Аккаунт";
  const lines = (name ? [email, phone] : [phone]).filter(Boolean);
  return { title, lines, initials: initialsOf(name, title) };
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
