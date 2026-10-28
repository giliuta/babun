// НОВАЯ СБОРКА САЙТА — ПО ИМЕНИ БАНДЛА.
//
// Вкладка и PWA держат загруженный JS, пока их не перезагрузят руками:
// service worker у сайта нет, а `index.html` с адреса браузер
// перепроверяет только при переходе. Человек днями работал в сборке, которую
// уже заменили, — без меню «…» в записи и без исправлений.
//
// Версия у веб-сборки уже есть, сервер не нужен: Expo кладёт бандл под
// именем с хэшем содержимого (`/_expo/static/js/web/entry-<хэш>.js`), и
// `index.html` ссылается ровно на него. Новый выпуск — новое имя в свежем
// `index.html`. Сверяем имя, на котором работает вкладка, с тем, что сайт
// отдаёт сейчас.

const BUNDLE = /\/_expo\/static\/js\/web\/(entry-[0-9a-f]+)\.js/;

/** Сколько ждать между проверками, пока вкладка открыта. */
export const WEB_BUILD_CHECK_MS = 10 * 60 * 1000;

/** Имя бандла из разметки `index.html`; `null` — разметка без бандла. */
export function bundleIdOf(html: string): string | null {
  return BUNDLE.exec(html)?.[1] ?? null;
}

/** Имя бандла, на котором работает эта вкладка. В разработке (Metro)
 *  бандл зовётся иначе — тогда `null`, и проверка молчит. */
export function runningBundleId(scripts: ArrayLike<{ src: string }>): string | null {
  for (let i = 0; i < scripts.length; i += 1) {
    const id = bundleIdOf(scripts[i]?.src ?? "");
    if (id) return id;
  }
  return null;
}

/** Вышла ли новая сборка. Пустой ответ (сеть, страница ошибки) — не
 *  новая: плашка о несуществующей версии хуже молчания. */
export function isNewBuild(running: string | null, served: string | null): boolean {
  return running !== null && served !== null && served !== running;
}
