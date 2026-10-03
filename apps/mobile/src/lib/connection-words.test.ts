import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadErrorWords, looksLikeNoConnection } from "./connection-words";

const what = { failed: "Не удалось загрузить финансы", later: "Финансы загрузятся, как только сервер ответит." };

describe("обрыв связи — словами, отказ — как есть", () => {
  test("нет сети, вышло время, упал сервер — «Нет связи с сервером»", () => {
    for (const error of [
      new Error("listTransactionsForRange: TypeError: Network request failed"),
      new Error("AbortError: Aborted"),
      new Error("Не удалось проверить роль: сеть не отвечает"),
      Object.assign(new Error("<html>522</html>"), { status: 522 }),
      new Error("upstream 504 Gateway Timeout"),
    ]) {
      assert.equal(looksLikeNoConnection(error), true, error.message);
      assert.deepEqual(loadErrorWords(error, what), { title: "Нет связи с сервером", subtitle: what.later });
    }
  });

  test("отказ сервера остаётся своим текстом", () => {
    const error = new Error("permission denied for table transactions");
    assert.equal(looksLikeNoConnection(error), false);
    assert.deepEqual(loadErrorWords(error, what), { title: what.failed, subtitle: error.message });
  });
});
