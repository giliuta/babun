import { useEffect, useRef } from "react";
import type { CountryCode } from "libphonenumber-js";
import {
  countryDialCode,
  dialPrefix,
  formatPhoneAsYouType,
  formatPhoneForDisplay,
} from "@/lib/phone";

// КОД СТРАНЫ — ЧАСТЬ НАБРАННОГО НОМЕРА: код страны пишут прямо в номере, а
// стандартный код вписывается по выбору региона. Пустое поле начинается с кода страны
// команды («+357 »), дальше печатают цифры; номер другой страны — стёрли код
// и вписали свой («+375 29 …»), страна определяется по нему. Шторки выбора
// страны у номера больше нет — ни у нового клиента, ни на карточке, ни в
// профиле. В данные уходит полный номер, как набран.

/** Номер, набранный без «+», получает код страны команды; со своим «+» —
 *  как есть. Пусто — пусто. */
export function withHomeCode(typed: string, home: CountryCode): string {
  const s = typed.trim();
  if (!s) return "";
  return s.startsWith("+") ? s : `${countryDialCode(home)} ${s}`;
}

/** ЖИВОЕ ПОЛЕ НОМЕРА НОВОГО КЛИЕНТА. Поле рождается с кодом страны команды
 *  прямо в черновике (`+357`): `draftPhoneTyped` один код набранным не
 *  считает. Команду узнали кадром позже (из записи, после загрузки команд)
 *  — код в ещё не набранном поле меняется на её («+357» → «+30»); стёртый
 *  руками код не возвращается. */
export function useDraftPhone({
  phone,
  home,
  onChange,
}: {
  /** Полный номер, как он лежит в черновике. */
  phone: string;
  /** Страна команды — её код стоит в пустом поле. */
  home: CountryCode;
  onChange: (full: string) => void;
}) {
  const seeded = useRef<string | null>(null);
  useEffect(() => {
    const dial = countryDialCode(home);
    const typed = phone.trim();
    const untouched = seeded.current === null ? typed === "" : typed === seeded.current;
    if (!untouched || typed === dial) return;
    seeded.current = dial;
    onChange(dialPrefix(home));
    // onChange — свежая функция каждый рендер; сеять заново только по смене
    // страны или номера.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home, phone]);

  return {
    value: formatPhoneAsYouType(phone, home),
    onType: (typed: string) => onChange(typed),
  };
}

/** ПОЛЕ СОХРАНЁННОГО НОМЕРА (`FieldRow` не live): карточка клиента, профиль,
 *  сотрудник. В поле — весь номер с кодом; пустое при правке начинается с
 *  кода страны команды (`seed`), один оставленный код — пустой номер. */
export function usePhoneField({
  phone,
  home,
  onSave,
}: {
  /** Полный номер, как он сохранён. */
  phone: string;
  home: CountryCode;
  /** `false` — номер отклонён: строка оставит набранное для правки. */
  onSave: (full: string) => unknown;
}) {
  return {
    value: formatPhoneForDisplay(phone, home),
    seed: dialPrefix(home),
    onSave: (typed: string) => onSave(withHomeCode(typed, home)),
  };
}
