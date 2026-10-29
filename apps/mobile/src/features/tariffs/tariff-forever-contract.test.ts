import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// ТАРИФ «НАВСЕГДА» НЕ ВИДИТ СЧЁТА. Аккаунту, которому тариф выдан без
// оплаты, строка «Рабочих календарей: N — €… в месяц» обещала списание,
// которого не будет: он не платит. Строка счёта прячется по тому же признаку,
// что гасит выбор тарифа и кнопку оплаты (`state.forever`).

const screen = readFileSync(join(__dirname, "TariffScreen.tsx"), "utf8");

test("строка «Рабочих календарей — сумма в месяц» не показывается тарифу навсегда", () => {
  assert.match(screen, /forever=\{state\.forever\}/);
  const line = screen.indexOf("`Рабочих календарей: ${calendars}");
  assert.ok(line > 0, "строка счёта пропала со страницы совсем");
  // Весь блок цен под тарифом гаснет у «навсегда» (`CAN_PAY_HERE && !forever`).
  const guard = screen.lastIndexOf("CAN_PAY_HERE && !forever ? (", line);
  assert.ok(guard > 0 && line - guard < 300, "строка счёта показывается без проверки «навсегда»");
});
