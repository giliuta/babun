import { ScrollView, Text, View } from "react-native";
import { Download, Info } from "lucide-react-native";

import { BrandMark } from "@/components/brand/BrandMark";
import { Divider } from "@/components/ui/Divider";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { useThemeColors } from "@/theme/colors";

import { updateSummary, versionSummary } from "./about";
import { appBuildFacts, appUpdateFacts } from "./app-facts";

// СТРАНИЦА «О ПРИЛОЖЕНИИ» (Кабинет, 2026-09-15). Что в ней и чего в ней пока
// нет — в шапке `about.ts`.
//
// ОБЕ СТРОКИ — ПОКАЗАНИЯ, БЕЗ НАЖАТИЯ (06.10, выпуск в магазины). «Обновление»
// раньше проверяло канал, скачивало и предлагало перезапуск; в приложении из
// магазина обновление вне App Store не предлагают, поэтому строка только
// говорит, откуда пришёл код и когда. Скачанное по воздуху встаёт само при
// следующем запуске.

// Вшитый отступ разделителя: поле строки 16 + бокс нейтрального глифа 20 + зазор 12.
const NEUTRAL_ROW_INSET = 48;

export function AboutScreen() {
  const t = useThemeColors();
  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="О приложении" />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={{ alignItems: "center", paddingTop: 24, paddingBottom: 20 }}>
          <BrandMark size={72} variant="tile" />
          <Text
            maxFontSizeMultiplier={1.2}
            style={{ marginTop: 12, fontSize: 28, lineHeight: 34, fontWeight: "800", letterSpacing: -0.5, color: t.ink }}
          >
            Babun
          </Text>
        </View>
        <SectionCard>
          <SettingsRow
            tile="neutral"
            icon={Info}
            title="Версия"
            sub={versionSummary(appBuildFacts())}
          />
          <Divider inset={NEUTRAL_ROW_INSET} />
          <SettingsRow
            tile="neutral"
            icon={Download}
            title="Обновление"
            sub={updateSummary(appUpdateFacts(), Date.now())}
          />
        </SectionCard>
      </ScrollView>
    </Screen>
  );
}
