import { useRouter, type Href } from "expo-router";
import { Info } from "lucide-react-native";

import { SettingsRow } from "@/components/ui/SettingsRow";

import { versionSummary } from "./about";
import { appBuildFacts } from "./app-facts";

// «О ПРИЛОЖЕНИИ» — СТРОКА-ДВЕРЬ КАБИНЕТА (разрез 007 + 008, 2026-09-15). Место в
// корне выбирает 007. Подпись — текущее значение, а не описание кнопки: версия
// и номер сборки видны без захода внутрь. Плитка нейтральная: в словаре
// `SETTINGS_TILE` пигмента «о приложении» нет, а заводить его ради одной строки —
// тот самый дрейф, от которого словарь написан.
export function AboutRow() {
  const router = useRouter();
  return (
    <SettingsRow
      tile="neutral"
      icon={Info}
      title="О приложении"
      sub={versionSummary(appBuildFacts())}
      onPress={() => router.push("/cabinet/about" as Href)}
    />
  );
}
