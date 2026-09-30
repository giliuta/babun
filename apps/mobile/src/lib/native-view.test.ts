import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// НАТИВНЫЙ ПАКЕТ, ДОБАВЛЕННЫЙ ПОСЛЕ СБОРКИ КЛИЕНТА, РОНЯЕТ ЭКРАН ЦЕЛИКОМ.
//
// Владелец 2026-09-10: «нажимаю на карту посмотреть точку — сразу ошибка;
// реши и обойди всё вокруг, чтобы такого больше никогда не было».
//
// Как это выглядит: `react-native-maps` стоит в `package.json`, JS-часть
// требуется без жалоб, `MapView` импортируется и выглядит живым — а нативной
// вьюхи `AIRMap` в уже собранном дев-клиенте нет. Падает РЕНДЕР, ошибка не
// поймана, и вместо формы объекта человек видит красный экран.
//
// try/catch вокруг `require` от этого не спасает: он проверяет JS, а нет —
// нативной части. Спрашивать надо у самого приложения (`hasNativeView`), и
// этот тест следит, чтобы спрашивали всегда: пакетов с нативной вьюхой в
// продукте будет больше, а сборки на руках у владельца и у соседних сессий
// всегда старше ветки.

const here = dirname(fileURLToPath(import.meta.url));
/** `apps/mobile` */
const app = resolve(here, "../..");

/** Пакет с нативной ВЬЮХОЙ → имя этой вьюхи в сборке. */
const NATIVE_VIEWS: Record<string, string> = {
  "react-native-maps": "AIRMap",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (
      (full.endsWith(".tsx") || full.endsWith(".ts")) &&
      !full.endsWith(".test.ts") &&
      !full.endsWith(".test.tsx")
    )
      out.push(full);
  }
  return out;
}

describe("нативная вьюха не роняет экран", () => {
  test("перед рендером спрашивают сборку, а не JS", () => {
    const files = [...walk(resolve(app, "src")), ...walk(resolve(app, "app"))];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const [pkg, view] of Object.entries(NATIVE_VIEWS)) {
        if (!source.includes(`"${pkg}"`)) continue;
        assert.ok(
          source.includes(`hasNativeView("${view}")`),
          `${relative(app, file)}: берёт ${pkg}, но не спрашивает hasNativeView("${view}") — ` +
            "на клиенте, собранном без этого модуля, экран упадёт «View config not found»",
        );
      }
    }
  });

  test("сама проверка не может бросить", () => {
    const guard = readFileSync(resolve(app, "src/lib/native-view.ts"), "utf8");
    assert.match(guard, /catch \{\s*return false;/, "осечка проверки обязана значить «нет»");
    assert.match(
      guard,
      /hasViewManagerConfig/,
      "нужен и старый способ спросить: новая архитектура отвечает через слой совместимости",
    );
  });
});
