import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { blockColorsFor, blockEdge, CANCELLED_EDGE } from "./status-colors";
import {
  contrastRatio,
  deepen,
  fillOver,
  tintOver,
  GRID_WORST,
} from "@/components/ui/color-contrast";
import { PRESET_COLORS } from "@babun/shared/common/utils/colors";

// ФОН ДЛЯ ИЗМЕРЕНИЯ ОБЯЗАН БЫТЬ НЕПРОЗРАЧНЫМ.
//
// `contrastRatio` отбрасывает альфу: контраст меряется по КОМПОЗИТУ, а не по
// прозрачному цвету. Значит любое значение, которое уезжает в `deepen`
// фоном, должно быть уже сложено с подложкой. Пока `BlockColors.fill` был
// строкой `${hue}2e`, точка чужой метки затемнялась об ПОЛНЫЙ цвет записи —
// вдвое более тёмную цель, чем настоящая заливка, — и переставала быть
// узнаваемой ровно там, где она единственный сигнал.

describe("цвета блока записи", () => {
  test("заливка непрозрачна для любого цвета палитры", () => {
    for (const preset of PRESET_COLORS) {
      const { fill } = blockColorsFor(preset.value);
      assert.match(
        fill,
        /^#[0-9a-f]{6}$/i,
        `${preset.name}: заливка ${fill} несёт альфу — измерения о неё соврут`,
      );
    }
  });

  test("заливка — тот же композит, которым меряют кант", () => {
    for (const preset of PRESET_COLORS) {
      assert.equal(blockColorsFor(preset.value).fill, fillOver(preset.value));
    }
  });

  test("один объект на цвет: React.memo полутора сотен блоков недели", () => {
    assert.equal(blockColorsFor("#FF9500"), blockColorsFor("#FF9500"));
  });

  test("кант забирает только отменённая", () => {
    // Кант — единственный надёжный канал КАТЕГОРИИ (заливка при 18 % даёт по
    // палитре максимум попарного ΔE 6.7). Право забрать его есть ровно у
    // одного состояния; просрочка своё право потеряла — при протанопии её
    // янтарь и оранжевое «нет объекта» дают ΔE 0.0.
    for (const preset of PRESET_COLORS) {
      const c = blockColorsFor(preset.value);
      for (const status of ["scheduled", "in_progress", "completed"] as const) {
        assert.equal(
          blockEdge(c, status),
          c.edge,
          `${preset.name}/${status} отнял кант у цвета записи`,
        );
      }
      assert.equal(blockEdge(c, "cancelled"), CANCELLED_EDGE);
    }
  });

  test("кант отменённой держит 3 : 1 — пунктир убирает половину чернил", () => {
    // Разомкнутый кант — единственный канал отмены на узком блоке, где нет ни
    // имени, ни углового знака. Штрих съедает примерно половину чернил, значит
    // оставшаяся половина обязана держать порог и к сетке, и к своей заливке.
    assert.ok(contrastRatio(CANCELLED_EDGE, GRID_WORST) >= 3);
    assert.ok(
      contrastRatio(CANCELLED_EDGE, tintOver("#0b1220", GRID_WORST, 0.0784)) >= 3,
    );
  });

  test("точка чужой метки видна на заливке любого цвета записи", () => {
    for (const record of PRESET_COLORS) {
      const { fill } = blockColorsFor(record.value);
      for (const label of PRESET_COLORS) {
        const dot = deepen(label.value, [fill]);
        assert.ok(
          contrastRatio(dot, fill) >= 3,
          `метка ${label.name} на записи ${record.name}: точка ${dot} даёт ${contrastRatio(dot, fill).toFixed(2)}`,
        );
      }
    }
  });

  test("и не топится глубже нужного — зелёная метка на кобальтовой записи", () => {
    // Тот самый случай: было #11401c при контрасте 5.98 : 1 вместо трёх.
    const { fill } = blockColorsFor("#005BD3");
    const dot = deepen("#34C759", [fill]);
    const ratio = contrastRatio(dot, fill);
    assert.ok(ratio >= 3, `точка ${dot} даёт ${ratio.toFixed(2)}`);
    assert.ok(
      ratio < 4.5,
      `точка ${dot} затемнена до ${ratio.toFixed(2)} — метка перестала быть собой`,
    );
    assert.notEqual(dot, deepen("#34C759", ["#005BD32e"]));
  });
});
