import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// ЖЁСТКАЯ ПРОВЕРКА КАЛЕНДАРЯ 03.10 — СТОРОЖА ПРАВОК, КОТОРЫЕ НЕ ПОДНЯТЬ БЕЗ
// СИМУЛЯТОРА (экран и жесты тянут react-native). Каждый держит конкретную
// поломку, найденную разбором «как сломать то, что пользователь не делает».

const here = dirname(fileURLToPath(import.meta.url));
const screen = () =>
  readFileSync(resolve(here, "../../../app/(dashboard)/(home)/index.tsx"), "utf8");
const block = () => readFileSync(resolve(here, "AppointmentBlock.tsx"), "utf8");

describe("календарь под нагрузкой", () => {
  test("быстрое событие рождается с uuid — «Отменить» удаляет именно его", () => {
    assert.match(screen(), /total_amount: 0,\s*\}\), id: randomUuid\(\) \};\s*createAppt\.mutate\(ev,/);
  });

  test("двойной тап не открывает форму записи дважды", () => {
    const src = screen();
    assert.match(src, /if \(at - lastBookPushRef\.current < 700\) return;/);
    for (const fn of ["const bookAt = (", "const openEdit = (", "const pickSlotForClient = ("]) {
      const body = src.slice(src.indexOf(fn), src.indexOf(fn) + 4000);
      assert.match(body, /pushBookOnce\(\{\s*pathname: "\/book"/, fn);
    }
  });

  test("режимы снимаются: уход с экрана, смена компании, Месяц и Список", () => {
    const src = screen();
    assert.match(src, /setPick\(null\);\s*setMoving\(null\);\s*setEditingApt\(null\);\s*\},\s*\[\],/);
    assert.match(src, /setMoving\(null\);\s*setEditingApt\(null\);\s*setPick\(null\);\s*\}, \[tenantId\]\);/);
    assert.match(src, /if \(m === "month" \|\| m === "agenda"\) setEditingApt\(null\);/);
  });

  test("«Свободное перемещение» заканчивается тапом и без «Новых записей»", () => {
    assert.equal(
      (screen().match(/onCreateAt=\{canCreateOnGrid \|\| moving \|\| editingApt \? createAtGrid : undefined\}/g) ?? []).length,
      2,
    );
  });

  test("конец 23:59 — конец суток: перенос не сжимает запись на минуту", () => {
    const src = block();
    assert.match(src, /const spanEnd = endMin >= 23 \* 60 \+ 59 \? 24 \* 60 : endMin;/);
    assert.equal((src.match(/const duration = Math\.max\(15, spanEnd - startMin\);/g) ?? []).length, 2);
    assert.doesNotMatch(src, /Math\.max\(endMin, winEnd\)/);
  });

  test("подпись под пальцем ограничена так же, как отпускание", () => {
    assert.match(block(), /clampStart\(startMin \+ steps \* dragStep, Math\.max\(15, spanEnd - startMin\)\)/);
  });
});
