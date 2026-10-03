import { ScrollView } from "react-native";
import { UI_LOCALES, type UiLocale } from "@babun/shared/i18n/locales";
import { saveUiLocale, uiLocale } from "@babun/shared/i18n/locale";

import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SelectList, SelectRow } from "@/components/ui/select-rows";
import { haptics } from "@/lib/haptics";

import { reloadApp } from "./reload-app";

// СТРАНИЦА «ЯЗЫКИ» (Кабинет → «Этот телефон», владелец 03.10: «в кабинете
// добавь новую страницу языки, чтоб можно было выбирать языки»).
//
// Язык — свойство телефона, как уведомления: у двух человек на одном
// аккаунте может быть по своему. Строка — имя языка на нём самом («English»),
// чтобы человек нашёл свой, даже не читая текущий; ниже — то же имя на
// языке приложения. Тап выбирает и сразу перезапускает приложение уже на
// новом языке: второго шага («Применить», «Перезапустить?») нет.

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

export function LanguagesScreen() {
  const current = uiLocale();

  const choose = (code: UiLocale) => {
    if (code === current) return;
    haptics.tap();
    if (saveUiLocale(code)) reloadApp();
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Языки" />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <SelectList>
          {UI_LOCALES.map((locale) => {
            const inUi = LANGUAGE_IN_UI[locale.code];
            return (
            <SelectRow
              key={locale.code}
              icon={locale.flag}
              title={locale.name}
              // Язык, на котором приложение уже говорит, второй раз не
              // подписываем: «Русский · Русский».
              subtitle={locale.code === current ? undefined : inUi}
              selected={locale.code === current}
              accessibilityRole="radio"
              onPress={() => choose(locale.code)}
            />
            );
          })}
        </SelectList>
      </ScrollView>
    </Screen>
  );
}
