import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { helpFaq, LEGAL_LINKS } from "../cabinet/help";
import { fillLegal, LEGAL_TEXTS, legalLang, parseLegal, type LegalDocId } from "./legal-texts";
import { isLegalReady } from "./operator";

// ДОКУМЕНТЫ ДЛЯ МАГАЗИНОВ (04.10). Ссылки из карточек App Store и Google Play
// обязаны открываться без входа и называть, кто обрабатывает данные; русский
// и английский — один и тот же документ.

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../app");
const DOCS = Object.keys(LEGAL_TEXTS) as LegalDocId[];
const FILL = { name: "Babun Ltd", address: "Limassol, Cyprus", email: "help@babun.app" };

describe("тексты", () => {
  for (const doc of DOCS) {
    test(`${doc}: оба языка — с названием, датой и теми же разделами`, () => {
      const ru = parseLegal(fillLegal(LEGAL_TEXTS[doc].ru, FILL));
      const en = parseLegal(fillLegal(LEGAL_TEXTS[doc].en, FILL));
      for (const blocks of [ru, en]) {
        assert.equal(blocks[0]?.kind, "title");
        assert.equal(blocks[1]?.kind, "paragraph");
        assert.match(blocks[1]!.text, /2026/);
      }
      const headings = (b: typeof ru) => b.filter((x) => x.kind === "heading").length;
      const items = (b: typeof ru) => b.filter((x) => x.kind === "item").length;
      assert.equal(headings(ru), headings(en), "разное число разделов");
      assert.equal(items(ru), items(en), "разное число пунктов");
    });

    test(`${doc}: подстановки — все, и почта есть в тексте`, () => {
      for (const lang of ["ru", "en"] as const) {
        const filled = fillLegal(LEGAL_TEXTS[doc][lang], FILL);
        assert.doesNotMatch(filled, /\{[A-Z]+\}/);
        assert.ok(filled.includes(FILL.email), `${doc}/${lang}: нет почты для связи`);
      }
    });
  }

  test("русский текст не уходит в словарь интерфейса", () => {
    const src = readFileSync(path.join(APP, "../src/features/legal/legal-texts.ts"), "utf8");
    for (const name of ["PRIVACY_RU", "TERMS_RU", "DELETE_RU"]) {
      assert.match(src, new RegExp(`const ${name} = /\\* i18n-ignore \\*/ \``));
    }
  });

  test("пустой реквизит — «—», а не дыра посреди фразы", () => {
    assert.match(fillLegal("{NAME} ({ADDRESS})", { name: "", address: " ", email: "" }), /^— \(—\)$/);
  });
});

test("язык: явный параметр, иначе русский только для русского интерфейса", () => {
  assert.equal(legalLang("en", "ru"), "en");
  assert.equal(legalLang("ru", "de"), "ru");
  assert.equal(legalLang(undefined, "ru"), "ru");
  assert.equal(legalLang(undefined, "el"), "en");
  assert.equal(legalLang("fr", "uk"), "en");
});

test("готовность: без имени, адреса и почты документы не выкладывают", () => {
  assert.equal(isLegalReady({ name: "", address: "x" }, "a@b.c"), false);
  assert.equal(isLegalReady({ name: "x", address: "x" }, ""), false);
  assert.equal(isLegalReady({ name: "x", address: "x" }, "a@b.c"), true);
});

test("адреса без входа: файл маршрута и строка в корневом стеке", () => {
  const root = readFileSync(path.join(APP, "_layout.tsx"), "utf8");
  for (const name of ["privacy", "terms", "delete-account", "support"]) {
    assert.ok(existsSync(path.join(APP, `${name}.tsx`)), `нет app/${name}.tsx`);
    assert.match(root, new RegExp(`<Stack.Screen name="${name}" />`));
  }
  for (const link of LEGAL_LINKS) assert.ok(existsSync(path.join(APP, `${link.href.slice(1)}.tsx`)));
});

test("«Помощь» в приложении из магазина не говорит о ценах тарифа и оплате", () => {
  const native = helpFaq(false).map((i) => `${i.question} ${i.answer}`).join("\n");
  assert.doesNotMatch(native, /Stripe|оплат|пополн|€/i);
  assert.ok(helpFaq(true).some((i) => i.id === "tariff"), "на сайте вопрос о тарифе остаётся");
});
