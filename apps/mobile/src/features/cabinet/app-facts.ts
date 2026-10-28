import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { DISPLAY_VERSION } from "@babun/shared/common/utils/version";

import { shownVersion, type AppBuildFacts, type AppUpdateFacts } from "./about";

// Факты о запущенном коде берутся из нативных модулей здесь, а слова над ними
// решает чистый `about.ts` — там они и проверены тестом.

export function appBuildFacts(): AppBuildFacts {
  return {
    displayVersion: shownVersion({
      web: Platform.OS === "web",
      storeVersion: Constants.expoConfig?.version,
      internalVersion: DISPLAY_VERSION,
    }),
    buildNumber: Constants.platform?.ios?.buildNumber ?? null,
  };
}

/** Когда собран сайт — строка ISO, которую вшивает `build:web`. На телефоне и
 *  в разработке её нет. */
export function webBuiltAt(): Date | null {
  const raw = process.env.EXPO_PUBLIC_WEB_BUILT_AT;
  if (!raw) return null;
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? null : at;
}

export function appUpdateFacts(): AppUpdateFacts {
  return {
    // Сборка разработки берёт код из Metro: `isEnabled` там бывает true, а
    // проверка обновления падает — строка обещала бы то, чего нет (в дев-клиенте
    // была бы «Версия из сборки» с шевроном).
    enabled: Updates.isEnabled && !__DEV__,
    embedded: Updates.isEmbeddedLaunch,
    createdAt: Updates.createdAt,
  };
}
