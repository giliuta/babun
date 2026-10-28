import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// Ввод номера, ошибки и «Поделиться» на вебе.
const src = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file: string) => readFileSync(join(src, file), "utf8");

describe("страница клиентов: ввод и веб", () => {
  test("С1: отклонённый номер остаётся в строке для правки", () => {
    assert.match(
      read("components/ui/card-rows/use-field-row.ts"),
      /const rejected = !cur\.live && typed !== cur\.value && cur\.onSave\(typed\) === false;\s*setEditing\(rejected\);/,
    );
    assert.match(
      read("features/clients/ClientHeader.tsx"),
      /toast\("Номер не распознан — проверьте код страны", "error"\);[\s\S]{0,120}return false;/,
    );
  });

  test("С2: ошибка на вебе — тост через хост, не окно браузера", () => {
    assert.ok(
      read("lib/notify.ts").includes(
        'if (!toastOutsideTree(text, "error", NOTIFY_MS)) globalThis.alert?.(text);',
      ),
    );
    assert.ok(read("components/ui/Toast.tsx").includes("hostShow = own;"));
  });

  test("Л9: «Поделиться» из списка и из карточки — с запасным буфером", () => {
    for (const file of [
      "features/clients/list/use-list-row-actions.ts",
      "features/clients/card/card-menu-actions.ts",
    ]) {
      const code = read(file);
      assert.ok(code.includes("await shareMessage(shareText("), file);
      assert.ok(!code.includes("Share.share("), file);
    }
  });

  test("Л9: приложение представляется Nominatim", () => {
    assert.match(read("features/clients/geocode.ts"), /"User-Agent": "Babun\/1\.0 \(\+https:\/\/babun\.app\)"/);
  });
});
