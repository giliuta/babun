import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { DISPLAY_VERSION } from "@babun/shared/common/utils/version";

import type { AppBuildFacts, AppUpdateFacts } from "./about";

// Факты о запущенном коде берутся из нативных модулей здесь, а слова над ними
// решает чистый `about.ts` — там они и проверены тестом.

export function appBuildFacts(): AppBuildFacts {
  return {
    displayVersion: DISPLAY_VERSION,
    buildNumber: Constants.platform?.ios?.buildNumber ?? null,
  };
}

export function appUpdateFacts(): AppUpdateFacts {
  return {
    // Сборка разработки берёт код из Metro: `isEnabled` там бывает true, а
    // проверка обновления падает — строка обещала бы то, чего нет (проверено
    // на Pro 2026-09-15: «Версия из сборки» с шевроном в дев-клиенте).
    enabled: Updates.isEnabled && !__DEV__,
    embedded: Updates.isEmbeddedLaunch,
    createdAt: Updates.createdAt,
  };
}
