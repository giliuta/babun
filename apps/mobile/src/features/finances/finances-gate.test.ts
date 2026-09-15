import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { financesGate } from "./finances-gate";

describe("financesGate", () => {
  test("владелец видит сами финансы", () => {
    assert.equal(financesGate("owner"), "open");
  });

  test("мастер и диспетчер — та же страница серым, а не «раздел недоступен»", () => {
    assert.equal(financesGate("master"), "locked");
    assert.equal(financesGate("dispatcher"), "locked");
  });

  test("роль ещё не известна или членства нет — решает граница прав", () => {
    assert.equal(financesGate(undefined), "boundary");
    assert.equal(financesGate(null), "boundary");
  });
});
