import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  contrastRatio,
  readableColorOnTint,
  readableTextOnColor,
} from "./color-contrast";
import { light } from "../../theme/colors";

describe("light UI contrast", () => {
  test("measures the WCAG reference extremes", () => {
    assert.equal(contrastRatio("#000000", "#ffffff"), 21);
    assert.equal(contrastRatio("invalid", "#ffffff"), 0);
  });

  test("uses dark text on bright solid swatches and white on dark ones", () => {
    assert.equal(
      readableTextOnColor("#f5a623", "#0b1220", "#ffffff"),
      "#0b1220",
    );
    assert.equal(
      readableTextOnColor("#2c5be0", "#0b1220", "#ffffff"),
      "#ffffff",
    );
  });

  test("does not render a bright user hue as low-contrast text on its tint", () => {
    assert.equal(
      readableColorOnTint("#f5a623", "#ffffff", "#0b1220", 0x22 / 255),
      "#0b1220",
    );
    assert.equal(
      readableColorOnTint("#075e54", "#ffffff", "#0b1220", 0x22 / 255),
      "#075e54",
    );
  });

  test("keeps fixed-light secondary text readable on common surfaces", () => {
    for (const foreground of [light.sub, light.faint, light.placeholder]) {
      assert.ok(contrastRatio(foreground, light.canvas) >= 4.5);
      assert.ok(contrastRatio(foreground, light.surface) >= 4.5);
      assert.ok(contrastRatio(foreground, light.fill) >= 4.5);
    }
    assert.ok(contrastRatio(light.onAccent, light.accentFrom) >= 4.5);
    assert.ok(contrastRatio(light.onAccent, light.accentTo) >= 4.5);
  });
});
