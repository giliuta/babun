import { compareVersions } from "@/features/app-update/update-verdict";

/** Первая версия из магазина, в которой обучение живое. */
const ONBOARDING_FIRST_VERSION = "1.0.4";

// ОБУЧЕНИЕ — ТОЛЬКО В СБОРКЕ, КОТОРУЮ ВИДЕЛ ПРОВЕРЯЮЩИЙ APPLE. Оно меняет
// регистрацию (первый календарь называет человек), а регистрация меняется
// только через проверку магазина, не по воздуху в версию, где её не видели.
// Поэтому решает версия САМОЙ СБОРКИ: `runtimeVersion` берётся из натива
// (политика appVersion), и обновление по воздуху на 1.0.3 его не поднимет.
// Dev-клиент своей версии сборки не знает — смотрит версию из app.json, чтобы
// обучение можно было проверить на симуляторе. Веб пока без обучения: на нём
// его не проходили, а замки вкладок без живой подсказки заперли бы разделы.
export function onboardingServerReady(input: {
  platform: string;
  dev: boolean;
  runtimeVersion: string | null | undefined;
  configVersion: string | null | undefined;
}): boolean {
  if (input.platform === "web") return false;
  const version = input.dev ? input.configVersion : input.runtimeVersion;
  if (!version) return false;
  return compareVersions(version, ONBOARDING_FIRST_VERSION) >= 0;
}
