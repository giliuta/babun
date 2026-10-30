// ЧТО ПЕЧАТАЕТ КАРТА ЧЕЛОВЕКА сверху Кабинета.
//
// Имя — `user_metadata.full_name` (пишется при регистрации и правится в
// «Профиле»), телефон — `user_metadata.phone` (сам человек его вписал, не
// подтверждён), почта — логин аккаунта. У старых аккаунтов имени нет: тогда
// на месте имени стоит почта, а второй раз её не печатаем.
//
// КАРТА — ТОЛЬКО ЧЕЛОВЕК: имя, под ним почта, под ней номер, если он есть.
// Имени аккаунта (компании), дня рождения и инициалов здесь нет — это
// «Профиль»; карта лишь дверь в него. Пустое не печатается.

import { formatPhoneForDisplay } from "@/lib/phone";

type PersonCardView = {
  title: string;
  /** Строки под именем: почта, затем номер — только непустые. */
  lines: { kind: "email" | "phone"; text: string }[];
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
  const lines: PersonCardView["lines"] = [];
  if (name && email) lines.push({ kind: "email", text: email });
  if (phone) lines.push({ kind: "phone", text: formatPhoneForDisplay(phone) });
  return { title, lines };
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
