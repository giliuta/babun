import { UI_LOCALES, type UiLocale } from "@babun/shared/i18n/locales";
import { uiLocale } from "@babun/shared/i18n/locale";

import { haptics } from "@/lib/haptics";

import { SelectList, SelectRow } from "./select-rows";

// СПИСОК ЯЗЫКОВ — ОДИН НА ПРОДУКТ. Им выбирают язык приложения (Кабинет →
// «Языки») и язык бумаги инвойса (блок «Язык» над документом): один и тот же
// вопрос «на каком языке» обязан выглядеть одинаково.
//
// Строка — флаг, имя языка на нём самом («English»), ниже — то же имя на
// языке приложения («Английский»), чтобы свой язык нашёл и тот, кто не читает
// текущий. Язык, на котором приложение уже говорит, второй раз не подписан.

/** Имя языка на языке приложения — вторая строка. */
const LANGUAGE_IN_UI: Record<UiLocale, string> = {
  ru: "Русский",
  en: "Английский",
  bg: "Болгарский",
  el: "Греческий",
  uk: "Украинский",
  de: "Немецкий",
  es: "Испанский",
};

export function LanguageOptionList({
  selected,
  onPick,
}: {
  selected: UiLocale;
  onPick: (code: UiLocale) => void;
}) {
  const ui = uiLocale();
  return (
    <SelectList>
      {UI_LOCALES.map((locale) => (
        <SelectRow
          key={locale.code}
          icon={locale.flag}
          title={locale.name}
          subtitle={locale.code === ui ? undefined : LANGUAGE_IN_UI[locale.code]}
          selected={locale.code === selected}
          accessibilityRole="radio"
          onPress={() => {
            haptics.tap();
            onPick(locale.code);
          }}
        />
      ))}
    </SelectList>
  );
}
