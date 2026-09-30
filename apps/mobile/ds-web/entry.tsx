// Точка входа сборки для Claude Design: все блоки — на `window.__BabunUI`.
// Обёртка `.design-sync/build-web.mjs` раздаёт их именованными экспортами.
import * as UI from "./exports";

(globalThis as unknown as { __BabunUI: typeof UI }).__BabunUI = UI;
