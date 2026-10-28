// УБИРАЕТ СТАРЫЙ SERVICE WORKER. У нынешнего сайта своего нет — этот файл
// существует только затем, чтобы снести тот, что поставил прежний сайт на
// Next.js (кеши `babun-v827-*`). Он отдавал страницы из своего кеша, и
// браузер, однажды открывший старый сайт, навсегда застревал на старой
// сборке: новая выкладка до него не доходила, а `/sw.js` отвечал страницей
// приложения — обновить его браузеру было нечем.
//
// Браузер сам сверяет `/sw.js` при заходе на сайт; этот файл новее — он
// встаёт на место старого, стирает его кеши, снимает себя и перезагружает
// открытые вкладки уже с сервера.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
      const windows = await self.clients.matchAll({ type: "window" });
      for (const client of windows) client.navigate(client.url);
    })(),
  );
});
