import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  BLOCK_TEXT,
  BLOCK_TEXT_MIN,
  blockOverdueEdge,
  blockPressed,
  blockSolid,
  contrastRatio,
} from "./color-contrast";
import { hexToOklch } from "./oklch";
import { PRESET_COLORS } from "@babun/shared/common/utils/colors";

// ПЛОТНЫЙ БЛОК ЗАПИСИ (вариант 7): белое имя читается на каждом цвете палитры,
// а сам цвет остаётся собой — затемняется светлота, не тон.

const hueDeg = (hex: string) => {
  const lch = hexToOklch(hex);
  assert.ok(lch, hex);
  return (lch[2] * 180) / Math.PI;
};
const hueDelta = (a: string, b: string) => {
  const d = Math.abs(hueDeg(a) - hueDeg(b)) % 360;
  return d > 180 ? 360 - d : d;
};

describe("плотный блок записи", () => {
  for (const preset of PRESET_COLORS) {
    test(`${preset.name}: белое имя ≥ ${BLOCK_TEXT_MIN} : 1, тон на месте`, () => {
      const solid = blockSolid(preset.value);
      assert.ok(
        contrastRatio(BLOCK_TEXT, solid) >= BLOCK_TEXT_MIN,
        `${preset.value} → ${solid}: ${contrastRatio(BLOCK_TEXT, solid).toFixed(2)}`,
      );
      // Затемнение к чёрному уводило янтарь в коричневый на ~15°; по
      // светлоте OKLCH тон сдвигается только обрезкой гамута.
      assert.ok(
        hueDelta(preset.value, solid) <= 8,
        `${preset.name}: тон уехал на ${hueDelta(preset.value, solid).toFixed(1)}°`,
      );
    });
  }

  test("уже тёмный цвет не трогается", () => {
    assert.equal(blockSolid("#4B1D82"), "#4b1d82");
  });

  test("янтарный остаётся оранжевым, а не коричневым", () => {
    const [l, c] = hexToOklch(blockSolid("#FDAA1B")) ?? [0, 0];
    // Коричневый — это низкая светлота И низкая сочность; держим сочность.
    assert.ok(c >= 0.12, `сочность ${c.toFixed(3)}`);
    assert.ok(l >= 0.5, `светлота ${l.toFixed(3)}`);
  });

  test("под пальцем — глубже покоя, имя по-прежнему читается", () => {
    for (const { value } of PRESET_COLORS) {
      const idle = blockSolid(value);
      const pressed = blockPressed(value);
      assert.ok(
        contrastRatio(BLOCK_TEXT, pressed) > contrastRatio(BLOCK_TEXT, idle),
        value,
      );
    }
  });

  test("ободок просрочки виден на своей заливке", () => {
    for (const { value } of PRESET_COLORS) {
      const edge = blockOverdueEdge(value);
      assert.ok(
        contrastRatio(edge, blockSolid(value)) >= 1.8,
        `${value}: ${contrastRatio(edge, blockSolid(value)).toFixed(2)}`,
      );
    }
  });

  test("кэш возвращает то же значение", () => {
    assert.equal(blockSolid("#FDAA1B"), blockSolid("#FDAA1B"));
  });
});
