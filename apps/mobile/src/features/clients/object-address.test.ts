import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addressOrLinkPatch, objectTarget } from "./object-address";

describe("objectTarget", () => {
  test("адрес важнее ссылки", () => {
    assert.equal(
      objectTarget({ address: "Ул. 5, Лимассол", mapUrl: "https://maps.app.goo.gl/x" }),
      "Ул. 5, Лимассол",
    );
  });

  test("остался только пин — показываем его, а не пустоту", () => {
    // Объект из веба часто несёт ОДИН пин. Пустое поле читалось как
    // «куда ехать не заполнено», хотя ссылка есть.
    assert.equal(
      objectTarget({ address: "", mapUrl: "https://maps.app.goo.gl/x" }),
      "https://maps.app.goo.gl/x",
    );
  });

  test("ничего нет / нет объекта", () => {
    assert.equal(objectTarget({ address: "  ", mapUrl: null }), "");
    assert.equal(objectTarget(null), "");
    assert.equal(objectTarget(undefined), "");
  });
});

describe("addressOrLinkPatch", () => {
  test("текст — это адрес", () => {
    assert.deepEqual(addressOrLinkPatch("  Ул. 5, Лимассол "), {
      address: "Ул. 5, Лимассол",
      mapUrl: undefined,
    });
  });

  test("ссылка уезжает в пин, адрес вытаскивается из неё", () => {
    const patch = addressOrLinkPatch(
      "https://www.google.com/maps/place/Makariou+5,+Limassol/@34.6,33.0,17z",
    );
    assert.equal(
      patch.mapUrl,
      "https://www.google.com/maps/place/Makariou+5,+Limassol/@34.6,33.0,17z",
    );
    assert.equal(patch.address, "Makariou 5, Limassol");
  });

  test("короткая ссылка без адреса: пин есть, адрес пустой", () => {
    assert.deepEqual(addressOrLinkPatch("https://maps.app.goo.gl/abc"), {
      mapUrl: "https://maps.app.goo.gl/abc",
      address: "",
    });
  });

  test("короткая ссылка не стирает уже набранный адрес", () => {
    // Человек уточняет точку присланным пином — адрес при этом терять нельзя:
    // именно он читается в списке и уходит в SMS.
    assert.deepEqual(
      addressOrLinkPatch("https://maps.app.goo.gl/abc", {
        address: "Ул. 5, Лимассол",
      }),
      { mapUrl: "https://maps.app.goo.gl/abc", address: "Ул. 5, Лимассол" },
    );
  });

  test("правка адреса СОХРАНЯЕТ присланный пин", () => {
    assert.deepEqual(
      addressOrLinkPatch("Ул. 7, Лимассол", {
        address: "Ул. 5, Лимассол",
        mapUrl: "https://maps.app.goo.gl/abc",
      }),
      { address: "Ул. 7, Лимассол", mapUrl: "https://maps.app.goo.gl/abc" },
    );
  });

  test("текст поверх ссылки (адреса не было) — ссылку заменили", () => {
    // Поле показывало ссылку; набранный текст занял её место, значит пин
    // больше не описывает объект.
    assert.deepEqual(
      addressOrLinkPatch("Ул. 5, Лимассол", {
        address: "",
        mapUrl: "https://maps.app.goo.gl/abc",
      }),
      { address: "Ул. 5, Лимассол", mapUrl: undefined },
    );
  });

  test("перевод строки схлопывается в пробел", () => {
    // Return в multiline-поле вставляет «\n», а не сохраняет: адрес с
    // переводом рвался и в списке, и в SMS.
    assert.deepEqual(addressOrLinkPatch("Ленина 5\n кв 12\n"), {
      address: "Ленина 5 кв 12",
      mapUrl: undefined,
    });
  });

  test("пусто стирает и адрес, и пин", () => {
    assert.deepEqual(
      addressOrLinkPatch("   ", {
        address: "Ул. 5",
        mapUrl: "https://maps.app.goo.gl/abc",
      }),
      { address: "", mapUrl: undefined },
    );
  });
});
