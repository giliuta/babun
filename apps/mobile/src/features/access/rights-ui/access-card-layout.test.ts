import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// ЛЕНТА КОМАНД — ВНУТРИ «ДОСТУПА», ПРАВА АККАУНТА — НЕ ПОД НЕЙ (П4).
// Лента наверху страницы читалась переключателем всего (имя, почта,
// личное), а «Кабинет» под ней — правами выбранной команды, хотя он один на
// все его команды.

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string): string => readFileSync(resolve(here, path), "utf8");

describe("страница партнёра: «Доступ»", () => {
  test("лента — в карточке «Доступ», «Кабинет» — своей карточкой «Аккаунт»", () => {
    const card = read("./AccessSectionsCard.tsx");
    assert.match(card, /<SectionCard title="Доступ" padded=\{false\}>\s*\{chips \?\? null\}/);
    assert.match(card, /section\.key !== "company"/);
    assert.match(card, /<SectionCard title="Аккаунт" padded=\{false\}>/);
  });

  test("карточка партнёра отдаёт ленту в «Доступ», наверху — только без блока доступа", () => {
    const view = read("../master-page/MasterCardView.tsx");
    assert.match(view, /cloneElement\(p\.teamRights as ReactElement<\{ chips\?: ReactNode \}>, \{ chips: ribbon \}\)/);
    assert.match(view, /\{ribbon && !ribbonInAccess \? ribbon : null\}/);
  });
});
