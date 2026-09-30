import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { previewAreaOf, rightsFocusOf } from "./rights-focus";

describe("куда приземляется «Посмотреть его глазами»", () => {
  test("страница раздела без ?area= — в вкладку этого раздела", () => {
    assert.equal(previewAreaOf(undefined, rightsFocusOf("team-1", null, "clients")), "clients");
    assert.equal(previewAreaOf(undefined, rightsFocusOf("team-1", null, "finance")), "finance");
    assert.equal(previewAreaOf(undefined, rightsFocusOf("team-1", null, "record")), "calendar");
  });

  test("раздел из адреса главнее; без раздела — как было", () => {
    assert.equal(previewAreaOf("finance", rightsFocusOf("team-1", null, "clients")), "finance");
    assert.equal(previewAreaOf(undefined, rightsFocusOf("team-1", null, null)), undefined);
    assert.equal(previewAreaOf(undefined, undefined), undefined);
  });
});
