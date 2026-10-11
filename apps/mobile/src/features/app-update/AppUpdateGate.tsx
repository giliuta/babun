import { useEffect, type ReactNode } from "react";
import { Linking, Platform } from "react-native";
import Constants from "expo-constants";
import { useQuery } from "@tanstack/react-query";
import { Screen } from "@/components/ui/Screen";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { supabase } from "@/lib/supabase";
import { updateVerdict } from "./update-verdict";

// «ВЫШЛО ОБНОВЛЕНИЕ» — НАД ВСЕМИ ЭКРАНАМИ (владелец 11.10: «чтоб приложение
// говорило само, что нужно обновиться»). Правило — `update-verdict.ts`, числа
// — строка платформы в `app_release`, её правят после каждого выпуска.
//   • ниже минимальной версии — вместо приложения экран «Нужно обновить»;
//   • ниже последней — один раз за запуск плашка с кнопкой в магазин.
// В вебе обновлять нечего: сайт всегда последний.

type Release = { latest_version: string; min_version: string; store_url: string };

const PLATFORM = Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : null;
const CURRENT = Constants.expoConfig?.version ?? null;

/** Плашка — раз за запуск: напоминание, а не помеха. */
let nudged = false;

function useRelease() {
  return useQuery({
    queryKey: ["app-release", PLATFORM],
    enabled: PLATFORM !== null,
    // Выпуск — событие редкое: час свежести, проверка при возврате в приложение.
    staleTime: 60 * 60 * 1000,
    queryFn: async (): Promise<Release | null> => {
      const { data, error } = await supabase
        .from("app_release")
        .select("latest_version, min_version, store_url")
        .eq("platform", PLATFORM as string)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

export function AppUpdateGate({ children }: { children: ReactNode }) {
  const toast = useToast();
  const release = useRelease().data;
  const verdict = updateVerdict({
    current: CURRENT,
    latest: release?.latest_version,
    min: release?.min_version,
  });
  const openStore = () => {
    if (release?.store_url) void Linking.openURL(release.store_url);
  };

  useEffect(() => {
    if (verdict !== "soft" || nudged || !release) return;
    nudged = true;
    toast(`Доступна новая версия Babun ${release.latest_version}`, "info", {
      label: "Обновить",
      onPress: openStore,
    });
    // openStore читает release из того же рендера.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verdict, release]);

  if (verdict === "force") {
    return (
      <Screen>
        <EmptyState
          fill
          title="Нужно обновить Babun"
          subtitle={
            PLATFORM === "ios"
              ? "Эта версия устарела. Обновите приложение в App Store — данные сохранятся."
              : "Эта версия устарела. Обновите приложение в Google Play — данные сохранятся."
          }
          action={{ label: "Обновить", onPress: openStore }}
        />
      </Screen>
    );
  }
  return <>{children}</>;
}
