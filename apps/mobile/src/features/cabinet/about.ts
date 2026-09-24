import { clockTime, dayMonth } from "./when";

// «О ПРИЛОЖЕНИИ» — ЧТО ЗАПУЩЕНО НА ЭТОМ ТЕЛЕФОНЕ (Кабинет, 2026-09-15).
//
// Владелец ставит сборки TestFlight и получает обновления по воздуху, а вопрос
// «у меня уже новое?» решался только вопросом нам. Здесь — версия, номер сборки
// (тот же, что в TestFlight) и откуда пришёл код: из самой сборки или
// обновлением, и когда.
//
// УСЛОВИЙ И КОНФИДЕНЦИАЛЬНОСТИ ЗДЕСЬ ПОКА НЕТ: страниц `babun.app/terms` и
// `/privacy` не существует (сайт отвечает «Экран не найден» на любой путь), а
// строка-дверь в пустоту — худший вид вранья (закон `SettingsRow.onPress`).
// Поддержки нет по той же причине: живой контакт не подтверждён владельцем.

export interface AppBuildFacts {
  /** `DISPLAY_VERSION` — версия, которую продукт показывает человеку. */
  displayVersion: string;
  /** CFBundleVersion бинарника: номер сборки в TestFlight. */
  buildNumber: string | null;
}

export interface AppUpdateFacts {
  /** Обновления по воздуху включены в этой сборке (в сборке разработки — нет). */
  enabled: boolean;
  /** Запущен код, вшитый в сборку, а не пришедший обновлением. */
  embedded: boolean;
  createdAt: Date | null;
}

/** «v1.8.28 · сборка 4». */
export function versionSummary({ displayVersion, buildNumber }: AppBuildFacts): string {
  const build = buildNumber?.trim();
  return build ? `${displayVersion} · сборка ${build}` : displayVersion;
}

/** «Версия из сборки» · «Обновлено 15 сентября в 01:10». */
export function updateSummary(
  { enabled, embedded, createdAt }: AppUpdateFacts,
  now: number,
): string {
  if (!enabled) return "Недоступно в этой сборке";
  const at = createdAt?.getTime();
  if (embedded || at === undefined || Number.isNaN(at)) return "Версия из сборки";
  return `Обновлено ${dayMonth(at, now)} в ${clockTime(at)}`;
}
