import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { TENANT_HEADER, applyTenantHeader } from "./tenant-header";

const A = "2bc7907e-b149-44a9-92ff-a5e73403031c";
const B = "11365a87-bef9-4f6c-a030-b15083fe646b";

describe("заголовок компании на запросе", () => {
  test("фоновая компания ставится, когда вызывающий свою не назвал", () => {
    const h = applyTenantHeader(new Headers(), A);
    assert.equal(h.get(TENANT_HEADER), A);
  });

  test("явная компания вызывающего НЕ затирается фоновой", () => {
    // Ради этого правило и существует: прогрев чужой компании называет её сам,
    // а обёртка не имеет права подменить её активной.
    const h = new Headers({ [TENANT_HEADER]: B });
    applyTenantHeader(h, A);
    assert.equal(h.get(TENANT_HEADER), B);
  });

  test("без фоновой компании заголовка нет — сервер отвечает по токену", () => {
    const h = applyTenantHeader(new Headers(), null);
    assert.equal(h.get(TENANT_HEADER), null);
  });
});
