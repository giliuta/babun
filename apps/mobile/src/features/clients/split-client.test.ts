import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Client, PhoneEntry } from "@babun/shared/local/clients";
import { createBlankClient } from "@babun/shared/local/clients";
import {
  canSplitClient,
  encodeSplit,
  parseSplit,
  splitDraftParams,
  splitRowText,
  splitSourceStep,
  splittablePhones,
} from "./split-client";

// «РАЗДЕЛИТЬ КЛИЕНТА» (STORY-086, сценарий ж). Ошибка здесь стоит номера:
// вынесли не тот — он пропал из живой карточки; вынесли не туда — жена
// стала клиентом без связи с мужем. Поэтому каждое решение — вызовом.

const phone = (over: Partial<PhoneEntry> = {}): PhoneEntry => ({
  id: "p-wife",
  number: "+357 99 123456",
  label: "Жена",
  name: "Мария",
  ...over,
});

const pavel = (over: Partial<Client> = {}): Client =>
  ({ ...createBlankClient(), id: "pavel", ...over }) as Client;

// Ключ номера — цифры с плюсом: в приложении это `tryToE164`, здесь хватает
// того же свойства «одинаковый номер разной записи — один ключ».
const keyOf = (n: string) => {
  const digits = n.replace(/[^\d+]/g, "");
  return digits ? digits : null;
};

describe("какие номера можно вынести", () => {
  test("только дополнительные и непустые", () => {
    const rows = splittablePhones(
      pavel({ phones: [phone(), phone({ id: "p-empty", number: "   " })] }),
    );
    assert.deepEqual(rows.map((p) => p.id), ["p-wife"]);
  });

  test("пункт есть у сохранённой карточки с правами и номерами", () => {
    const client = pavel({ phones: [phone()] });
    assert.equal(canSplitClient({ client, isDraft: false, canEdit: true, canLinks: true }), true);
  });

  test("нет номеров — нет пункта", () => {
    const base = { isDraft: false, canEdit: true, canLinks: true };
    assert.equal(canSplitClient({ ...base, client: pavel({ phones: [] }) }), false);
    assert.equal(
      canSplitClient({ ...base, client: pavel({ phones: [phone({ number: "" })] }) }),
      false,
    );
  });

  test("черновик, без права менять, без права связей, в архиве — нет пункта", () => {
    const client = pavel({ phones: [phone()] });
    const ok = { client, isDraft: false, canEdit: true, canLinks: true };
    assert.equal(canSplitClient({ ...ok, isDraft: true }), false);
    assert.equal(canSplitClient({ ...ok, canEdit: false }), false);
    assert.equal(canSplitClient({ ...ok, canLinks: false }), false);
    assert.equal(
      canSplitClient({ ...ok, client: pavel({ phones: [phone()], deleted_at: "2026-09-20" }) }),
      false,
    );
    assert.equal(canSplitClient({ ...ok, client: undefined }), false);
  });
});

describe("адрес черновика", () => {
  test("номер основным, имя с номера, связь с исходной без роли, сплит", () => {
    const params = splitDraftParams("pavel", phone());
    assert.deepEqual(params, {
      linkGroup: "pavel",
      phone: "+357 99 123456",
      name: "Мария",
      split: encodeSplit({ sourceId: "pavel", phoneId: "p-wife" }),
    });
    assert.equal("linkRole" in params, false, "роль пустая — её впишут");
  });

  test("без имени на номере имени в адресе нет", () => {
    const params = splitDraftParams("pavel", phone({ name: "  " }));
    assert.equal("name" in params, false);
  });

  test("сплит доезжает адресом туда и обратно", () => {
    const ref = { sourceId: "pavel", phoneId: "p-wife" };
    assert.deepEqual(parseSplit(encodeSplit(ref)), ref);
  });

  test("обрывок адреса — не сплит", () => {
    assert.equal(parseSplit(undefined), null);
    assert.equal(parseSplit(""), null);
    assert.equal(parseSplit("pavel"), null);
    assert.equal(parseSplit("pavel~"), null);
    assert.equal(parseSplit("~p-wife"), null);
    assert.equal(parseSplit("a~b~c"), null);
    assert.equal(parseSplit(["pavel~p-wife"]), null);
  });
});

describe("строка шторки «Кого выносим»", () => {
  test("подпись и имя сверху, номер снизу", () => {
    assert.deepEqual(splitRowText(phone()), { label: "Жена · Мария", hint: "+357 99 123456" });
  });

  test("без подписи строка — сам номер", () => {
    assert.deepEqual(splitRowText(phone({ label: "", name: "" })), { label: "+357 99 123456" });
  });
});

describe("номер уходит из исходной", () => {
  const other = phone({ id: "p-work", number: "+357 22 000000", label: "Рабочий", name: "" });

  test("патч — свежий массив без вынесенного номера", () => {
    const step = splitSourceStep(
      pavel({ phones: [phone(), other] }),
      "p-wife",
      "+35799123456",
      keyOf,
    );
    assert.deepEqual(step, { kind: "patch", patch: { phones: [other] } });
  });

  test("патч строится из свежей строки: номер, добавленный пока шёл черновик, цел", () => {
    const added = phone({ id: "p-new", number: "+357 96 111111", label: "Сын", name: "" });
    const step = splitSourceStep(
      pavel({ phones: [phone(), other, added] }),
      "p-wife",
      "+35799123456",
      keyOf,
    );
    assert.equal(step.kind, "patch");
    if (step.kind === "patch") {
      assert.deepEqual(step.patch.phones.map((p) => p.id), ["p-work", "p-new"]);
    }
  });

  test("номера в исходной уже нет — убирать нечего", () => {
    assert.deepEqual(
      splitSourceStep(pavel({ phones: [other] }), "p-wife", "+35799123456", keyOf),
      { kind: "gone" },
    );
  });

  test("в черновике набрали другой номер — исходную не трогаем", () => {
    assert.deepEqual(
      splitSourceStep(pavel({ phones: [phone(), other] }), "p-wife", "+35797777777", keyOf),
      { kind: "changed" },
    );
    assert.deepEqual(
      splitSourceStep(pavel({ phones: [phone(), other] }), "p-wife", null, keyOf),
      { kind: "changed" },
    );
  });
});
