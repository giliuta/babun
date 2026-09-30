import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Location } from "@babun/shared/local/clients";
import { requisitesLines, shareText } from "./client-share";

const loc = (over: Partial<Location>): Location => ({
  id: over.id ?? "l",
  label: "",
  address: "",
  isPrimary: false,
  ...over,
});

const base = {
  full_name: "Мария Спиру",
  phone: "+357 99 123456",
  locations: [] as Location[],
  legal_name: null,
  vat_number: null,
  reg_number: null,
  billing_address: null,
};

describe("shareText — текст «Поделиться» для бригады", () => {
  test("имя и телефон первыми строками", () => {
    assert.equal(shareText(base, { requisites: false }), "Мария Спиру\n+357 99 123456");
  });

  test("все объекты, основной первым; ссылка и заметка своими строками", () => {
    const text = shareText(
      {
        ...base,
        locations: [
          loc({ id: "a", label: "Офис", address: "Makariou 12, Limassol" }),
          loc({
            id: "b",
            label: "Дом",
            address: "Agias Fylaxeos 5",
            mapUrl: "https://maps.app.goo.gl/abc",
            note: "зелёная дверь,\nдомофон 25",
            isPrimary: true,
          }),
          loc({ id: "c", label: "Склад", address: "", mapUrl: "https://maps.google.com/?q=1,2" }),
        ],
      },
      { requisites: false },
    );
    assert.equal(
      text,
      [
        "Мария Спиру\n+357 99 123456",
        "Дом: Agias Fylaxeos 5\nhttps://maps.app.goo.gl/abc\nзелёная дверь, домофон 25",
        "Офис: Makariou 12, Limassol",
        "Склад\nhttps://maps.google.com/?q=1,2",
      ].join("\n\n"),
    );
  });

  test("объект без типа называется «Объект»", () => {
    const text = shareText(
      { ...base, locations: [loc({ address: "Ledras 1" })] },
      { requisites: false },
    );
    assert.equal(text.split("\n\n")[1], "Объект: Ledras 1");
  });

  const withRequisites = {
    ...base,
    legal_name: "Spirou Holdings Ltd",
    vat_number: "CY10012345X",
    reg_number: "",
    billing_address: "Arch. Makariou III 1\nNicosia 1065",
  };

  test("реквизиты — только по праву", () => {
    assert.ok(!shareText(withRequisites, { requisites: false }).includes("Spirou"));
    assert.ok(!shareText(withRequisites, { requisites: false }).includes("Реквизиты"));
    assert.equal(
      shareText(withRequisites, { requisites: true }).split("\n\n").at(-1),
      "Реквизиты:\nSpirou Holdings Ltd\nVAT CY10012345X\nArch. Makariou III 1, Nicosia 1065",
    );
  });

  test("право есть, реквизитов нет — пустого заголовка нет", () => {
    assert.equal(shareText(base, { requisites: true }), "Мария Спиру\n+357 99 123456");
  });

  test("без имени — «Клиент», без телефона — строки нет", () => {
    assert.equal(shareText({ ...base, full_name: " ", phone: "" }, { requisites: false }), "Клиент");
  });
});

describe("requisitesLines — копирование строки реквизитов", () => {
  test("пустые поля не печатаются, номера с подписью", () => {
    assert.deepEqual(
      requisitesLines({
        legal_name: " Acme Ltd ",
        vat_number: null,
        reg_number: "HE 123",
        billing_address: "",
      }),
      ["Acme Ltd", "Рег. HE 123"],
    );
  });
});
