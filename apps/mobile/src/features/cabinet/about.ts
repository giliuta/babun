import { clockTime, dayMonth } from "./when";

// «О ПРИЛОЖЕНИИ» — ЧТО ЗАПУЩЕНО НА ЭТОМ ТЕЛЕФОНЕ (Кабинет).
//
// Владелец ставит сборки TestFlight и получает обновления по воздуху, и ему
// нужно видеть, новое ли у него уже стоит. Здесь — версия, номер сборки
// (тот же, что в TestFlight) и откуда пришёл код: из самой сборки или
// обновлением, и когда.
//
// ВЕРСИЯ МАГАЗИНА, А НЕ ВНУТРЕННЯЯ (выпуск в магазины). В приложении с
// телефона строка говорит то же, что App Store: «1.0.0 · сборка 12».
// Внутренний номер `v1.8.33` придуман для сайта и наших сборок; на телефоне он
// расходился бы с карточкой магазина, и проверка App Store видела бы две версии
// одного приложения. Сайт показывает внутренний.
//
// ОБНОВЛЕНИЕ — ТОЛЬКО ПОКАЗАНИЕ. Кнопок «проверить», «скачать», «перезапустить»
// нет: в приложении из магазина обновление не предлагают вне App Store, а
// обновление по воздуху и так встаёт само при следующем запуске.
//
// УСЛОВИЯ И КОНФИДЕНЦИАЛЬНОСТЬ — НЕ ЗДЕСЬ, А В «ПОМОЩИ» → «Документы»:
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

/** САЙТ — ОДНО ЧИСЛО И ДАТА ВЫПУСКА: «v1.8.33 · 28 октября в 16:10». У сайта
 *  нет ни номера сборки, ни обновления по воздуху — строка «Обновление · Версия
 *  из сборки» на вебе говорила о том, чего нет. Дату выпуска вшивает сборка
 *  сайта (`EXPO_PUBLIC_WEB_BUILT_AT` в `build:web`); без неё — только версия. */
export function webVersionSummary(version: string, builtAt: Date | null, now: number): string {
  const at = builtAt?.getTime();
  if (at === undefined || Number.isNaN(at)) return version;
  // Дата — своим шаблоном: словарь знает «{0} в {1}», а версия к ней
  // приставляется без слов.
  const when = `${dayMonth(at, now)} в ${clockTime(at)}`;
  return `${version} · ${when}`;
}
