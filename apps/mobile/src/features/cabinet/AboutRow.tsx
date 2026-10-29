import { useRouter, type Href } from "expo-router";
import { Info } from "lucide-react-native";

import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";

import { versionSummary } from "./about";
import { appBuildFacts } from "./app-facts";

// «О ПРИЛОЖЕНИИ» — СТРОКА-ДВЕРЬ КАБИНЕТА (разрез 007 + 008). Место в
// корне выбирает 007. Подпись — текущее значение, а не описание кнопки: версия
// и номер сборки видны без захода внутрь. Плитка — пигмент словаря, как у всех
// строк корня Кабинета (`cabinet-tiles.test.ts`).
export function AboutRow() {
  const router = useRouter();
  return (
    <SettingsRow
      tile={SETTINGS_TILE.purple}
      icon={Info}
      title="О приложении"
      sub={versionSummary(appBuildFacts())}
      onPress={() => router.push("/cabinet/about" as Href)}
    />
  );
}
