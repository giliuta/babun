import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { InvoicePaymentAlreadyRecordedError } from "@babun/shared/db/repositories/invoice-payments";
import { sendPayment } from "./payment-request";

const here = dirname(fileURLToPath(import.meta.url));

// ID ПЛАТЕЖА ЖИВЁТ ДО УСПЕХА, А НЕ ДО ОТКРЫТИЯ ЛИСТА. Лист рождал новый id на
// каждое открытие: ответ потерялся, лист закрыли и открыли — второй платёж
// теми же деньгами; поправили сумму после сбоя — вечный отказ «id уже
// использован».
describe("id платежа по инвойсу", () => {
  const counter = () => {
    let n = 0;
    return () => `id-${++n}`;
  };

  test("сбой связи — повтор, хоть с правками, уходит тем же id", async () => {
    const holder = { current: "id-0" };
    const sent: string[] = [];
    const fresh = counter();
    await assert.rejects(
      sendPayment(holder, async (id) => {
        sent.push(id);
        throw new TypeError("Network request failed");
      }, fresh),
    );
    await sendPayment(holder, async (id) => {
      sent.push(id);
    }, fresh);
    assert.deepEqual(sent, ["id-0", "id-0"]);
  });

  test("после записанного платежа следующий — с новым id", async () => {
    const holder = { current: "id-0" };
    await sendPayment(holder, async () => {}, counter());
    assert.equal(holder.current, "id-1");
  });

  test("«уже записан» — id сменён, ошибка дошла до листа", async () => {
    const holder = { current: "id-0" };
    await assert.rejects(
      sendPayment(holder, async () => {
        throw new InvoicePaymentAlreadyRecordedError();
      }, counter()),
      InvoicePaymentAlreadyRecordedError,
    );
    assert.equal(holder.current, "id-1");
  });

  test("лист сам id не рождает — его держит страница", () => {
    const sheet = readFileSync(resolve(here, "../InvoicePaymentSheet.tsx"), "utf8");
    assert.doesNotMatch(sheet, /randomUuid|request_id/);
    const hook = readFileSync(resolve(here, "use-invoice-detail.ts"), "utf8");
    assert.match(hook, /useRef\(randomUuid\(\)\)/);
    assert.match(hook, /sendPayment\(/);
  });
});
