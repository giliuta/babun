import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  contrastRatio,
  deepen,
  edgeColor,
  fillOver,
  fillRgba,
  markColor,
  readableColorOnTint,
  readableTextOnColor,
  tintOver,
  GRID_WORST,
} from "./color-contrast";
import { PRESET_COLORS } from "@babun/shared/common/utils/colors";
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

// ═══ ЦВЕТ ЗАПИСИ НА СЕТКЕ ═══
//
// Гейт живёт здесь, а не в календаре: он проверяет ПАЛИТРУ против ПОДЛОЖКИ, и
// сломать его может как новый цвет в справочнике, так и правка тонирования.

describe("цвет записи на сетке календаря", () => {
  test("parseHex понимает восьмизначный hex, иначе гейт зелёный впустую", () => {
    // Календарь красит заливку строкой `${hue}2e` — если её нельзя измерить,
    // все проверки контраста ниже меряют пустоту.
    assert.equal(contrastRatio("#0b1220ff", "#ffffff"), contrastRatio("#0b1220", "#ffffff"));
    assert.ok(contrastRatio("#ffffff2e", "#0b1220") > 1);
  });

  test("кант каждого цвета палитры берёт 3:1 и к подложке, и к своей заливке", () => {
    for (const preset of PRESET_COLORS) {
      const edge = edgeColor(preset.value);
      const fill = fillOver(preset.value);
      assert.ok(
        contrastRatio(edge, GRID_WORST) >= 3,
        `${preset.name}: кант ${edge} к подложке ${contrastRatio(edge, GRID_WORST).toFixed(2)}`,
      );
      assert.ok(
        contrastRatio(edge, fill) >= 3,
        `${preset.name}: кант ${edge} к заливке ${contrastRatio(edge, fill).toFixed(2)}`,
      );
    }
  });

  test("текст блока читается на любой заливке любого цвета палитры", () => {
    // Четыре плотности: обычная 18 %, выполненная 10 %, под пальцем 40 %.
    for (const preset of PRESET_COLORS) {
      for (const alpha of [0.1804, 0.102, 0.4]) {
        const bg = tintOver(preset.value, GRID_WORST, alpha);
        assert.ok(
          contrastRatio("#0b1220", bg) >= 4.5,
          `${preset.name} @${alpha}: имя ${contrastRatio("#0b1220", bg).toFixed(2)}`,
        );
        assert.ok(
          contrastRatio("rgba(11,18,32,0.86)", bg) >= 4.5,
          `${preset.name} @${alpha}: время ${contrastRatio("rgba(11,18,32,0.86)", bg).toFixed(2)}`,
        );
      }
    }
  });

  test("угловые знаки видны на самой тёмной и самой светлой заливке", () => {
    const darkest = fillOver("#4B1D82");
    const lightest = fillOver("#FFF0BC");
    for (const token of ["#087a52", "#955f00"]) {
      const mark = markColor(token);
      assert.ok(contrastRatio(mark, darkest) >= 3, `знак ${mark} на тёмной`);
      assert.ok(contrastRatio(mark, lightest) >= 3, `знак ${mark} на светлой`);
    }
  });

  test("deepen кэширует и возвращает вход, если это не цвет", () => {
    assert.equal(edgeColor("#FF9500"), edgeColor("#FF9500"));
    assert.equal(deepen("не цвет", [GRID_WORST]), "не цвет");
  });

  test("fillRgba даёт строку, которую понимает анимация", () => {
    assert.equal(fillRgba("#FF9500", 0.4), "rgba(255,149,0,0.4)");
  });
});
