import { clockTime, dayMonth } from "./when";

// «О ПРИЛОЖЕНИИ» — ЧТО ЗАПУЩЕНО НА ЭТОМ ТЕЛЕФОНЕ (Кабинет, 2026-09-15).
//
// Владелец ставит сборки TestFlight и получает обновления по воздуху, а вопрос
// «у меня уже новое?» решался только вопросом нам. Здесь — версия, номер сборки
// (тот же, что в TestFlight) и откуда пришёл код: из самой сборки или
// обновлением, и когда.
//
// ВЕРСИЯ МАГАЗИНА, А НЕ ВНУТРЕННЯЯ (06.10, выпуск в магазины). В приложении с
// телефона строка говорит то же, что App Store: «1.0.0 · сборка 12».
// Внутренний номер `v1.8.33` придуман для сайта и наших сборок; на телефоне он
// расходился с карточкой магазина, и проверка App Store видела две версии
// одного приложения. Сайт показывает внутренний, как раньше.
//
// ОБНОВЛЕНИЕ — ТОЛЬКО ПОКАЗАНИЕ. Кнопок «проверить», «скачать», «перезапустить»
// нет: в приложении из магазина обновление не предлагают вне App Store, а
// обновление по воздуху и так встаёт само при следующем запуске.
//
// УСЛОВИЯ И КОНФИДЕНЦИАЛЬНОСТЬ — НЕ ЗДЕСЬ, А В «ПОМОЩИ» → «Документы» (04.10):
// там же, где связь с поддержкой; те же страницы открываются без входа на
// babun.app/privacy, /terms, /delete-account (`features/legal`).

export interface AppBuildFacts {
  /** Версия, которую продукт показывает человеку (`shownVersion`). */
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

/** Какую версию показать: на телефоне — версию магазина (`expo.version`, она же
 *  CFBundleShortVersionString), на сайте — внутреннюю `DISPLAY_VERSION`. Пустая
 *  версия магазина на телефоне не бывает (её вшивает сборка) — тогда
 *  внутренняя, чтобы строка не осталась без числа. */
export function shownVersion({
  web,
  storeVersion,
  internalVersion,
}: {
  web: boolean;
  storeVersion: string | null | undefined;
  internalVersion: string;
}): string {
  if (web) return internalVersion;
  return storeVersion?.trim() || internalVersion;
}

/** «1.0.0 · сборка 12». */
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
