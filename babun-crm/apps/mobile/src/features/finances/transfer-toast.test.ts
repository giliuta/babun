import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { transferSuccessToast } from "./transfer-toast";

const LABELS = {
  amountText: "€640",
  fromLabel: "Наличные · Юра",
  toLabel: "Revolut · Дима",
};

describe("transferSuccessToast — итог перевода и право на «Отменить»", () => {
  test("сообщение называет сумму и обе стороны полностью", () => {
    const { message } = transferSuccessToast(LABELS, "group-1");
    assert.equal(message, "Переведено €640: Наличные · Юра → Revolut · Дима");
  });

  test("с transfer_group_id отмена доступна той же группой", () => {
    assert.equal(transferSuccessToast(LABELS, "group-1").undoGroupId, "group-1");
  });

  test("без группы тост не обещает «Отменить»", () => {
    // Кнопка, которой нечего отменять, хуже её отсутствия: человек жмёт —
    // и ничего не происходит.
    assert.equal(transferSuccessToast(LABELS, null).undoGroupId, null);
  });
});
