import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { groupedSecret, qrSvgOf, twoFactorOffered } from "./two-factor";

describe("двухфакторный вход в «Вход и безопасность»", () => {
  test("аккаунту проверки Apple не предлагаем, остальным — да", () => {
    assert.equal(twoFactorOffered("babun.app+review@gmail.com"), false);
    assert.equal(twoFactorOffered(" Babun.App+Review@gmail.com "), false);
    assert.equal(twoFactorOffered("artem@example.com"), true);
    assert.equal(twoFactorOffered(null), true);
  });

  test("QR из ответа сервера — разметка SVG, сырая и закодированная", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1H0z"/></svg>';
    assert.equal(qrSvgOf(`data:image/svg+xml;utf-8,${svg}`), svg);
    assert.equal(qrSvgOf(`data:image/svg+xml;utf-8,${encodeURIComponent(svg)}`), svg);
  });

  test("не SVG и пустое — нет QR, а не падение", () => {
    assert.equal(qrSvgOf("data:image/png;base64,AAAA"), null);
    assert.equal(qrSvgOf("data:image/svg+xml;utf-8,%E0%A4%A"), null);
    assert.equal(qrSvgOf(""), null);
    assert.equal(qrSvgOf(undefined), null);
  });

  test("ключ — четвёрками", () => {
    assert.equal(groupedSecret("JBSWY3DPEHPK3PXP"), "JBSW Y3DP EHPK 3PXP");
    assert.equal(groupedSecret("ABCDEF"), "ABCD EF");
    assert.equal(groupedSecret(null), "");
  });
});
