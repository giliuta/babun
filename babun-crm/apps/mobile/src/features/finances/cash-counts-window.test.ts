import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  COUNT_WINDOW,
  foldCashCounts,
  lastCountedOn,
  type CashCount,
} from "./cash-counts-window";

// «Ни разу не сверяли» — утверждение о деньгах кассы: печатать его можно
// только когда окно запроса закрыло всю историю тенанта. Эти тесты держат
// границу окна и тристейт подписи (дата / «ни разу» / «не знаем»).

function count(patch: Partial<CashCount> & Pick<CashCount, "id">): CashCount {
  return {
    accountId: "cash-yura",
    businessDate: "2026-08-10",
    countedAt: "2026-08-10T18:00:00.000Z",
    expected: 100,
    counted: 100,
    delta: 0,
    note: null,
    transactionId: null,
    ...patch,
  };
}

/** Окно из `n` строк одной кассы, отсортированное по времени вниз — как из
 *  запроса. Даты уводим в прошлое, чтобы первая строка была самой свежей. */
function window(n: number): CashCount[] {
  return Array.from({ length: n }, (_, i) =>
    count({
      id: `c${i}`,
      countedAt: `2026-08-10T18:00:${String(59 - (i % 60)).padStart(2, "0")}.000Z`,
    }),
  );
}

describe("окно сверок и тристейт lastCountedOn", () => {
  test("первая строка по счёту побеждает более старые", () => {
    const last = foldCashCounts([
      count({ id: "fresh", businessDate: "2026-08-10" }),
      count({ id: "stale", businessDate: "2026-08-01" }),
      count({ id: "other", accountId: "cash-vova", businessDate: "2026-08-05" }),
    ]);
    assert.equal(last.byAccount.get("cash-yura")?.id, "fresh");
    assert.equal(lastCountedOn(last, "cash-yura"), "2026-08-10");
    assert.equal(lastCountedOn(last, "cash-vova"), "2026-08-05");
  });

  test("неполное окно даёт право на «ни разу»: отсутствие кассы → null", () => {
    const last = foldCashCounts(window(COUNT_WINDOW - 1));
    assert.equal(last.complete, true);
    assert.equal(lastCountedOn(last, "cash-vova"), null);
  });

  test("ровно полное окно — «не знаем»: отсутствие кассы → undefined", () => {
    // За краем окна могла остаться история этой кассы — объявлять её
    // непересчитанной ни разу нельзя.
    const last = foldCashCounts(window(COUNT_WINDOW));
    assert.equal(last.complete, false);
    assert.equal(lastCountedOn(last, "cash-vova"), undefined);
    // Касса, попавшая в окно, дату получает независимо от полноты.
    assert.equal(lastCountedOn(last, "cash-yura"), "2026-08-10");
  });

  test("ответа ещё нет — подпись молчит: undefined, а не «ни разу»", () => {
    assert.equal(lastCountedOn(undefined, "cash-yura"), undefined);
  });

  test("пустая история — честный «ни разу» для любой кассы", () => {
    const last = foldCashCounts([]);
    assert.equal(last.complete, true);
    assert.equal(lastCountedOn(last, "cash-yura"), null);
  });
});
