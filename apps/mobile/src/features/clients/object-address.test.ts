import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  addressOrLinkPatch,
  addressPartsPatch,
  cleanAddressParts,
  composeAddress,
  hasAddressPlace,
  objectTarget,
  partsFromLine,
  routeAddress,
  sameAddressParts,
  composeDetails,
  objectPlacePatch,
  primaryLine,
  withoutStreet,
} from "./object-address";

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

describe("уточнение адреса", () => {
  const parts = {
    street: " Makariou 12 ",
    complex: "Sunny Court",
    entrance: "2",
    floor: "3",
    apartment: "5",
    city: "Лимасол",
    zip: "4000",
  };

  test("cleanAddressParts: обрезает, выкидывает пустое, undefined когда пусто", () => {
    assert.deepEqual(cleanAddressParts({ street: "  ", apartment: " 5 " }), { apartment: "5" });
    assert.equal(cleanAddressParts({ street: " ", city: "" }), undefined);
    assert.equal(cleanAddressParts(undefined), undefined);
  });

  test("composeAddress: полная строка и строка для карты", () => {
    assert.equal(
      composeAddress(parts),
      "Makariou 12, Sunny Court, подъезд 2, эт. 3, кв. 5, Лимасол 4000",
    );
    assert.equal(composeAddress(parts, { forRoute: true }), "Makariou 12, Sunny Court, Лимасол 4000");
    assert.equal(composeAddress({ street: "Makariou 12", apartment: "5" }), "Makariou 12, кв. 5");
    assert.equal(composeAddress({ city: "Пафос" }), "Пафос");
    assert.equal(composeAddress({}), "");
  });

  test("hasAddressPlace: без улицы, комплекса или города строка не собирается", () => {
    assert.equal(hasAddressPlace({ floor: "3", apartment: "5" }), false);
    assert.equal(hasAddressPlace({ complex: "Sunny Court" }), true);
  });

  test("routeAddress: части — геокодируемая часть, иначе строка как есть", () => {
    assert.equal(routeAddress({ address: "что угодно", addressParts: parts }), "Makariou 12, Sunny Court, Лимасол 4000");
    assert.equal(routeAddress({ address: " Ул. 5 ", addressParts: { apartment: "5" } }), "Ул. 5");
    assert.equal(routeAddress(null), "");
  });

  test("addressPartsPatch: строка собирается только при «где»; пустое снимает части", () => {
    assert.deepEqual(addressPartsPatch({ street: "Makariou 12", apartment: "5" }), {
      addressParts: { street: "Makariou 12", apartment: "5" },
      address: "Makariou 12, кв. 5",
    });
    assert.deepEqual(addressPartsPatch({ apartment: "5" }), { addressParts: { apartment: "5" } });
    assert.deepEqual(addressPartsPatch({ street: " " }), { addressParts: undefined });
  });
});

describe("partsFromLine / sameAddressParts", () => {
  test("строка уходит в «Улица и дом», ссылка — в пин, заполненное не трогаем", () => {
    assert.deepEqual(partsFromLine({}, " Makariou 12 ", ""), { parts: { street: "Makariou 12" }, pin: "" });
    assert.deepEqual(partsFromLine({}, "https://maps.app.goo.gl/x", ""), { parts: {}, pin: "https://maps.app.goo.gl/x" });
    assert.deepEqual(partsFromLine({ city: "Пафос" }, "Makariou 12", "p"), { parts: { city: "Пафос" }, pin: "p" });
    assert.deepEqual(partsFromLine({}, "  ", "p"), { parts: {}, pin: "p" });
  });
  test("sameAddressParts сравнивает после чистки", () => {
    assert.equal(sameAddressParts({ street: " A " }, { street: "A" }), true);
    assert.equal(sameAddressParts({ street: "A" }, { street: "B" }), false);
    assert.equal(sameAddressParts({ street: " " }, undefined), true);
  });
});

// Главная строка + уточнение (владелец 2026-09-06): улица и дом либо ссылка
// сверху, остальное — под сворачиваемым «Уточнением».
describe("главная строка и уточнение", () => {
  const details = { complex: "Sunny Court", entrance: "2", floor: "3", apartment: "5", city: "Лимасол", zip: "4000" };

  test("подпись свёрнутого уточнения — без улицы", () => {
    assert.equal(
      composeDetails({ ...details, street: "Makariou 12" }),
      "Sunny Court · подъезд 2 · эт. 3 · кв. 5 · Лимасол 4000",
    );
    assert.equal(composeDetails({}), "");
  });

  test("withoutStreet оставляет только уточнение", () => {
    assert.deepEqual(withoutStreet({ street: "Makariou 12", floor: " 3 " }), { floor: "3" });
  });

  test("главная строка: улица у объекта с частями, иначе адрес или пин", () => {
    assert.equal(primaryLine({ addressParts: { street: "Makariou 12", city: "Лимасол" } }), "Makariou 12");
    assert.equal(primaryLine({ addressParts: { city: "Лимасол" }, mapUrl: "https://maps.app.goo.gl/x" }), "https://maps.app.goo.gl/x");
    assert.equal(primaryLine({ address: "Ул. 5", mapUrl: "https://maps.app.goo.gl/x" }), "Ул. 5");
  });

  test("строка-текст + уточнение → собранный адрес и части", () => {
    const patch = objectPlacePatch("Makariou 12", details, "");
    assert.equal(patch.address, "Makariou 12, Sunny Court, подъезд 2, эт. 3, кв. 5, Лимасол 4000");
    assert.equal(patch.addressParts?.street, "Makariou 12");
    assert.equal(patch.mapUrl, undefined);
  });

  test("строка-ссылка + уточнение → пин из строки, улицы нет", () => {
    const patch = objectPlacePatch("https://maps.app.goo.gl/x", { city: "Лимасол" }, "");
    assert.equal(patch.mapUrl, "https://maps.app.goo.gl/x");
    assert.equal(patch.addressParts?.street, undefined);
    assert.equal(patch.address, "Лимасол");
  });

  test("строка-текст без уточнения — это «улица и дом»", () => {
    assert.deepEqual(objectPlacePatch("Ул. 5, Лимассол", {}, ""), {
      address: "Ул. 5, Лимассол",
      addressParts: { street: "Ул. 5, Лимассол" },
      mapUrl: undefined,
    });
  });

  test("строка-ссылка без уточнения — прежний разбор одной строки", () => {
    const patch = objectPlacePatch("https://maps.app.goo.gl/x", {}, "", { address: "Старый адрес" });
    assert.equal(patch.mapUrl, "https://maps.app.goo.gl/x");
    assert.equal(patch.address, "Старый адрес");
    assert.equal(patch.addressParts, undefined);
  });

  test("не-ссылка в поле пина не стирает прежний пин", () => {
    const patch = objectPlacePatch("Makariou 12", {}, "abc", { mapUrl: "https://maps.app.goo.gl/x" });
    assert.equal(patch.mapUrl, "https://maps.app.goo.gl/x");
  });

  test("пин из уточнения главнее ссылки в строке", () => {
    const patch = objectPlacePatch("https://a.example/1", { city: "Пафос" }, "https://b.example/2");
    assert.equal(patch.mapUrl, "https://b.example/2");
  });
});
