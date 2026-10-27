import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { withTileLock, type TileLock } from "./tile-lock";

// ДВА ТАПА В ОДНОМ КАДРЕ — ОДИН ПЛАТЁЖ. Блок оплаты тянет react-native и под
// раннером не поднимается: сам замок проверяется поведением, а то, что оба
// денежных пути плитки идут через него, — по исходнику.

const here = dirname(fileURLToPath(import.meta.url));

function payment() {
  let settle: (ok: boolean) => void = () => {};
  const sent: number[] = [];
  const send = () => {
    sent.push(sent.length + 1);
    return new Promise<void>((resolve, reject) => {
      settle = (ok) => (ok ? resolve() : reject(new Error("отказ")));
    }).catch(() => undefined);
  };
  return { sent, send, settle: (ok: boolean) => settle(ok) };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("замок плитки счёта", () => {
  test("два тапа до ответа — один платёж; после ответа плитка снова свободна", async () => {
    const lock: TileLock = { current: false };
    const p = payment();
    assert.equal(withTileLock(lock, p.send), true);
    assert.equal(withTileLock(lock, p.send), false);
    assert.deepEqual(p.sent, [1]);
    p.settle(true);
    await tick();
    assert.equal(lock.current, false);
    assert.equal(withTileLock(lock, p.send), true);
  });

  test("отказ сервера тоже освобождает плитку", async () => {
    const lock: TileLock = { current: false };
    const p = payment();
    withTileLock(lock, p.send);
    p.settle(false);
    await tick();
    assert.equal(lock.current, false);
  });

  test("без общего замка (как было: `busy` из рендера) — два платежа", () => {
    const p = payment();
    withTileLock({ current: false }, p.send);
    withTileLock({ current: false }, p.send);
    assert.deepEqual(p.sent, [1, 2]);
  });

  test("оба денежных пути плитки — оплата записи и инвойса — под замком", () => {
    const actions = readFileSync(resolve(here, "payment-actions.ts"), "utf8");
    assert.match(actions, /withTileLock\(tileLock, \(\) => \{[\s\S]*?return invoicePay\s*\.pay\(/);
    assert.match(actions, /withTileLock\(tileLock, \(\) => \{[\s\S]*?return record\s*\.mutateAsync\(/);
    assert.match(actions, /busy \|\| tileLock\.current \|\|/);
    const hook = readFileSync(resolve(here, "use-payment-block.ts"), "utf8");
    assert.match(hook, /const tileLock = useRef\(false\);/);
  });
});
