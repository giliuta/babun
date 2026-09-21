import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

// СИГНАЛ СМЕНЫ ПРАВ ДОЛЖЕН ДОХОДИТЬ ДО ЭКРАНА (этап 2, владелец 15.09: «чтоб
// всё сразу менялось в живом времени»). `AccessSignalsMount` тянет
// react-native и под раннером не поднимается, поэтому проверка — по исходнику:
// удалить обработчик, проверку версии или перечитку после обрыва — и права у
// человека перестанут меняться без перезапуска, а зелёные тесты этого не
// заметят.

const source = readFileSync(join(__dirname, "AppProviders.tsx"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
  .replace(/\s+/g, " ");

function handlerBody(event: string): string {
  const at = source.indexOf(`{ event: "${event}" }`);
  assert.ok(at >= 0, `нет обработчика ${event}`);
  const next = source.indexOf("channel.on(", at + 1);
  const end = next < 0 ? source.indexOf("channel.subscribe", at) : next;
  return source.slice(at, end < 0 ? undefined : end);
}

describe("сигнал access_changed", () => {
  test("обработчик есть и перечитывает свою карту этой компании", () => {
    const body = handlerBody("access_changed");
    assert.match(body, /const key = myAccessQueryKey\(tenantId\)/);
    assert.match(body, /invalidateQueries\(\{ queryKey: key \}\)/);
  });

  test("перечитывает только новее того, что есть (повтор не шумит)", () => {
    const body = handlerBody("access_changed");
    assert.match(
      body,
      /if \(!isNewerAccess\(payload\?\.version, queryClient\.getQueryData<MemberAccessMap>\(key\)\)\) return;/,
    );
  });

  test("после обрыва канала карта перечитывается сама", () => {
    assert.match(source, /channel\.subscribe\(\(status\) =>/);
    assert.match(
      source,
      /if \(status === "SUBSCRIBED"\) \{ if \(dropped\) void queryClient\.invalidateQueries\(\{ queryKey: \["my-access"\] \}\);/,
    );
    assert.match(source, /status === "CLOSED" \|\| status === "CHANNEL_ERROR" \|\| status === "TIMED_OUT"/);
  });
});
