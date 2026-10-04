import { useRouter, type Href } from "expo-router";
import { Languages } from "lucide-react-native";
import { localeInfo } from "@babun/shared/i18n/locales";
import { uiLocale } from "@babun/shared/i18n/locale";

import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";

// «ЯЗЫКИ» — СТРОКА-ДВЕРЬ КАБИНЕТА в блоке «Этот телефон» (владелец 03.10).
// Подпись — язык, на котором приложение говорит сейчас, его же словами.
// Плитка индиго: в словаре пигментов это «видимость и раскладка — что
// показывать на экране», а язык — ровно про то, как экран читается.
export function LanguageRow() {
  const router = useRouter();
  return (
    <SettingsRow
      tile={SETTINGS_TILE.indigo}
      icon={Languages}
      title="Языки"
      sub={localeInfo(uiLocale()).name}
      onPress={() => router.push("/cabinet/languages" as Href)}
    />
  );
}
