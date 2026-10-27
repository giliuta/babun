import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeRecordColorSettings } from "./calendar-settings";

test("палитра хранит и цвет выключенного случая — <ключ>_was", () => {
  const out = sanitizeRecordColorSettings({
    rule: "team",
    palette: { noObject: null, noObject_was: "#000000", unpaid: "#DD6600", junk: "#111111" },
    fallback: null,
  });
  assert.deepEqual(out.recordColorPalette, { noObject: null, noObject_was: "#000000", unpaid: "#DD6600" });
});
