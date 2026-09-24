import { useState } from "react";
import { ScrollView } from "react-native";
import * as Updates from "expo-updates";
import { Download, Info } from "lucide-react-native";

import { Divider } from "@/components/ui/Divider";
import { LoadingBar } from "@/components/ui/LoadingBar";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { useToast } from "@/components/ui/Toast";
import { confirmAction } from "@/lib/confirm";

import { updateSummary, versionSummary } from "./about";
import { appBuildFacts, appUpdateFacts } from "./app-facts";

// СТРАНИЦА «О ПРИЛОЖЕНИИ» (Кабинет, 2026-09-15). Что в ней и чего в ней пока
// нет — в шапке `about.ts`.
//
// «Обновление» — единственная живая команда страницы: проверить канал этой
// сборки, скачать и перезапуститься по согласию. В сборке разработки строка
// остаётся показанием без нажатия — код туда приходит из Metro.
//
// ОЖИДАНИЕ ДВИЖЕТСЯ (DS §5): проверка и загрузка идут по сети, и подпись
// «Проверяем…» одна читалась бы зависшей строкой — под шапкой едет `LoadingBar`.
// Фаза держится до ответа на «Перезапустить?»: иначе строка снова нажималась бы
// под открытым вопросом и запускала вторую загрузку поверх первой.

type Phase = "idle" | "checking" | "downloading" | "confirming" | "ready";

// Вшитый отступ разделителя: поле строки 16 + бокс нейтрального глифа 20 + зазор 12.
const NEUTRAL_ROW_INSET = 48;

const PHASE_SUB: Partial<Record<Phase, string>> = {
  checking: "Проверяем…",
  downloading: "Загружаем…",
  confirming: "Загружено",
  ready: "Загружено · применится при перезапуске",
};

export function AboutScreen() {
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>("idle");
  const update = appUpdateFacts();

  const offerRestart = async () => {
    setPhase("confirming");
    const restart = await confirmAction("Обновление загружено", {
      message: "Перезапустить приложение сейчас?",
      confirmLabel: "Перезапустить",
    });
    if (restart) {
      void Updates.reloadAsync();
      return;
    }
    // Отказ — не отмена: скачанное встанет при следующем запуске, и строка
    // говорит это, а тап по ней снова предлагает перезапуск.
    setPhase("ready");
  };

  const checkForUpdate = async () => {
    setPhase("checking");
    let available: boolean;
    try {
      const result = await Updates.checkForUpdateAsync();
      available = result.isAvailable || result.isRollBackToEmbedded;
    } catch {
      setPhase("idle");
      toast("Не удалось проверить обновление", "error");
      return;
    }
    if (!available) {
      setPhase("idle");
      toast("Установлена последняя версия");
      return;
    }
    setPhase("downloading");
    try {
      await Updates.fetchUpdateAsync();
    } catch {
      setPhase("idle");
      toast("Не удалось загрузить обновление", "error");
      return;
    }
    await offerRestart();
  };

  const onUpdatePress = !update.enabled
    ? undefined
    : phase === "idle"
      ? () => void checkForUpdate()
      : phase === "ready"
        ? () => void offerRestart()
        : undefined;

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="О приложении" />
      <LoadingBar visible={phase === "checking" || phase === "downloading"} />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
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
            sub={PHASE_SUB[phase] ?? updateSummary(update, Date.now())}
            onPress={onUpdatePress}
          />
        </SectionCard>
      </ScrollView>
    </Screen>
  );
}
