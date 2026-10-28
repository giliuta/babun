import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { personCardView } from "./person-card";

// В ЗЕРКАЛЕ КАБИНЕТ НЕ ДАЁТ ДВЕРЕЙ ВЛАДЕЛЬЦА. Сессия в зеркале — владельца:
// «Вход и безопасность» показывал его почту и пароль, «Выйти» разлогинивал
// его самого (выход сеть пропускает и в зеркале), а карта сверху печатала
// его имя и вела в его «Профиль».

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string): string => readFileSync(resolve(here, path), "utf8");

describe("Кабинет в зеркале", () => {
  test("«Вход и безопасность» и «Выйти из аккаунта» — только вне зеркала", () => {
    const source = read("../../../app/(dashboard)/cabinet/index.tsx");
    assert.match(source, /const mirror = useMirror\(\);/);
    assert.match(source, /\{mirror \? null : \(\s*<>\s*<TourTarget id="cabinet\.account">/);
    assert.match(source, /\{mirror \? null : \(\s*<SectionCard className="mt-4">\s*<ActionRow\s+label="Выйти из аккаунта"/);
  });

  test("карта сверху — того, за кем смотрят, без фактов и без двери в профиль", () => {
    const source = read("./PersonCard.tsx");
    assert.match(source, /const door = mirror \? undefined : onPress;/);
    const view = personCardView({ user_metadata: { full_name: "Иван" } }, null);
    assert.equal(view.title, "Иван");
    assert.deepEqual(view.facts, []);
  });
});
