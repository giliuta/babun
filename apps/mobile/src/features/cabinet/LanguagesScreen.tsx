import { ScrollView } from "react-native";
import type { UiLocale } from "@babun/shared/i18n/locales";
import { saveUiLocale, uiLocale } from "@babun/shared/i18n/locale";

import { LanguageOptionList } from "@/components/ui/LanguageOptionList";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";

import { reloadApp } from "./reload-app";

// СТРАНИЦА «ЯЗЫКИ» (Кабинет → «Этот телефон», владелец 03.10: «в кабинете
// добавь новую страницу языки, чтоб можно было выбирать языки»).
//
// Язык — свойство телефона, как уведомления: у двух человек на одном
// аккаунте может быть по своему. Список — общий `LanguageOptionList` (им же
// выбирают язык бумаги инвойса). Тап выбирает и сразу перезапускает
// приложение уже на новом языке: второго шага («Применить», «Перезапустить?»)
// нет.
export function LanguagesScreen() {
  const current = uiLocale();

  const choose = (code: UiLocale) => {
    if (code === current) return;
    if (saveUiLocale(code)) reloadApp();
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Языки" />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <LanguageOptionList selected={current} onPick={choose} />
      </ScrollView>
    </Screen>
  );
}
