// НОВАЯ СБОРКА САЙТА — ПО ИМЕНИ БАНДЛА.
//
// Вкладка и PWA держат загруженный JS, пока их не перезагрузят руками:
// своего service worker у сайта нет, а `index.html` с адреса браузер
// перепроверяет только при переходе. Человек днями работал в сборке, которую
// уже заменили, — без меню «…» в записи и без исправлений.
//
// Версия у веб-сборки уже есть, сервер не нужен: Expo кладёт бандл под
// именем с хэшем содержимого (`/_expo/static/js/web/index-<хэш>.js`, у
// сборки со входом `expo-router/entry` — `entry-<хэш>.js`), и `index.html`
// ссылается ровно на него. Новый выпуск — новое имя в свежем `index.html`.
// Сверяем: есть ли бандл, который сайт отдаёт сейчас, среди скриптов вкладки.
//
// ВКЛАДКА ГРУЗИТ НЕ ОДИН СКРИПТ. Словарь языка приходит отдельным чанком с
// тем же видом имени (`en-<хэш>.js`, а чанк может зваться и `index-…`), и
// встаёт в документ раньше главного. Поэтому вкладка отвечает не «своим
// именем», а списком: новая сборка — та, чьего бандла в списке нет. Чанки
// словарей названы по содержимому, и их адреса вшиты в главный бандл: правка
// словаря меняет и его имя.

const BUNDLE = /\/_expo\/static\/js\/web\/((?:entry|index)-[0-9a-f]+)\.js/;

/** Сколько ждать между проверками, пока вкладка открыта. */
export const WEB_BUILD_CHECK_MS = 10 * 60 * 1000;

/** Имя бандла из разметки `index.html`; `null` — разметка без бандла. */
export function bundleIdOf(html: string): string | null {
  return BUNDLE.exec(html)?.[1] ?? null;
}

/** Бандлы, которые загрузила эта вкладка. В разработке (Metro) бандл
 *  зовётся иначе — тогда список пуст, и проверка молчит. */
export function runningBundleIds(scripts: ArrayLike<{ src: string }>): string[] {
  const ids: string[] = [];
  for (let i = 0; i < scripts.length; i += 1) {
    const id = bundleIdOf(scripts[i]?.src ?? "");
    if (id) ids.push(id);
  }
  return ids;
}

/** Вышла ли новая сборка. Пустой ответ (сеть, страница ошибки) — не
 *  новая: плашка о несуществующей версии хуже молчания. */
export function isNewBuild(running: readonly string[], served: string | null): boolean {
  return running.length > 0 && served !== null && !running.includes(served);
}

/** Что нужно от `navigator.serviceWorker` и `caches` — в тесте подделки. */
interface WorkerRegistry {
  getRegistrations(): Promise<readonly { unregister(): Promise<boolean> }[]>;
}
interface CacheStore {
  keys(): Promise<string[]>;
  delete(key: string): Promise<boolean>;
}

/** СНЯТЬ ЧУЖОЙ SERVICE WORKER. Своего у сайта нет — любая регистрация
 *  осталась от прежнего сайта на Next.js: он отдавал страницы из своего
 *  кеша, и браузер застревал на старой сборке. Его сносит и файл-убийца
 *  `public/sw.js`, но тот срабатывает, только когда браузер сам решит
 *  сверить `/sw.js`; здесь — страховка при каждом старте. Кешей Cache API
 *  сайт тоже не заводит, их стираем вместе с ним. Сколько снято — для теста. */
export async function dropStaleServiceWorkers(
  registry: WorkerRegistry | undefined,
  cacheStore: CacheStore | undefined,
): Promise<number> {
  if (!registry) return 0;
  const registrations = await registry.getRegistrations();
  await Promise.all(registrations.map((r) => r.unregister()));
  if (registrations.length > 0 && cacheStore) {
    const keys = await cacheStore.keys();
    await Promise.all(keys.map((key) => cacheStore.delete(key)));
  }
  return registrations.length;
}
