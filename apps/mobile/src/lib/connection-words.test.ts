import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadErrorWords, looksLikeNoConnection, writeErrorWords } from "./connection-words";

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

describe("неудача действия — словами, что не сделано", () => {
  const deleting = { failed: "Не удалось удалить", notDone: "Клиент не удалён" };

  test("удаление без сети — «Нет связи с сервером», а не текст ошибки", () => {
    // Так дверь `member_trash_client` отдаёт обрыв (03.10).
    const error = new Error("TypeError: Network request failed");
    assert.deepEqual(writeErrorWords(error, deleting), {
      title: "Нет связи с сервером",
      subtitle: "Клиент не удалён. Повторите, когда связь вернётся.",
    });
  });

  test("отказ сервера — под словом неудачи, своим текстом", () => {
    const error = new Error("Нет права удалять клиентов");
    assert.deepEqual(writeErrorWords(error, deleting), {
      title: "Не удалось удалить",
      subtitle: "Нет права удалять клиентов",
    });
  });
});
