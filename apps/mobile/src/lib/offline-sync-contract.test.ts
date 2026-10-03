import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// АУДИТ РАБОТЫ БЕЗ СЕТИ 03.10. Мутация react-query по умолчанию
// (`networkMode: "online"`) без сети ставится НА ПАУЗУ В ПАМЯТИ: обёртки
// кэша (строка в SQLite + операция в очереди) не вызываются, и правка жила
// только до выгрузки приложения. Каждая мутация записей и клиентов —
// `NEVER_PAUSE`: обёртка кладёт правку в очередь сразу, а действие только
// сервера отказывает без сети честно.
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, "..", rel), "utf8");

function unpausedCount(src: string): { mutations: number; neverPause: number } {
  const mutations = (src.match(/return useMutation(?:<[^>]*>)?\(\{/g) ?? []).length;
  const neverPause = (src.match(/\.\.\.NEVER_PAUSE,|networkMode: "always"/g) ?? []).length;
  return { mutations, neverPause };
}

describe("работа без сети: правки не ждут в памяти", () => {
  test("мутации записей не встают на паузу без сети", () => {
    const src = read("features/calendar/mutations.ts");
    const { mutations, neverPause } = unpausedCount(src);
    // + общий объект опций правки (`useUpdateAppointmentOptions`).
    assert.equal(neverPause, mutations + 1);
    assert.match(src, /function useUpdateAppointmentOptions\(\) \{[\s\S]{0,200}return \{\s*\.\.\.NEVER_PAUSE,/);
  });

  test("мутации клиентов и тегов не встают на паузу без сети", () => {
    const src = read("features/clients/queries.ts");
    const { mutations, neverPause } = unpausedCount(src);
    assert.ok(mutations > 0);
    assert.ok(neverPause >= mutations, `${neverPause} < ${mutations}`);
  });

  test("слив очереди без сети не начинается", () => {
    assert.match(read("lib/sync-runtime.ts"), /isOnline: \(\) => onlineManager\.isOnline\(\),/);
  });

  test("«Удалить» в «Синхронизации» снимает с телефона только несохранённую вставку", () => {
    const src = readFileSync(resolve(here, "../../app/(dashboard)/cabinet/sync.tsx"), "utf8");
    assert.match(src, /if \(related\.some\(\(item\) => item\.op === "insert"\)\) \{\s*await cacheDelete\(op\.table, op\.row_id\)/);
  });
});
