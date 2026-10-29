import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { appointmentRowHash, monthDigests, monthsToRefetch, updatedAtMicros } from "./appointment-digest";

// ТЕЛЕФОН СЧИТАЕТ ОТПЕЧАТОК ТАК ЖЕ, КАК СЕРВЕР. Разойдутся — каждая сверка
// перечитывала бы все месяцы (тихо и дорого), а совпадение «по ошибке»
// оставило бы на сетке удалённую запись. Строки и отпечатки ниже — ответ
// боевой `appointment_month_digest` и полного чтения под RLS владельца в
// прогоне 28.10 (в откате; данные тестовые).

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const NAME = "20261028180000_appointment_month_digest.sql";
const file = [path.join(ROOT, "supabase/migrations", NAME), path.join(ROOT, "supabase/parked", NAME)].find((p) =>
  existsSync(p),
);
const SQL = file ? readFileSync(file, "utf8") : "";

type Row = { id: string; updated_at: string; date: string };
const rows = (list: [string, string, string][]): Row[] => list.map(([id, updated_at, date]) => ({ id, updated_at, date }));

const OWNER_984A = rows([
  ["17eaac02-4f83-4ecf-a9d2-52ecede2a3a6", "2026-10-04T12:45:09.512814+00:00", "2026-10-05"],
  ["aba863fd-323c-4021-9090-af47593dc324", "2026-10-04T12:46:18.94066+00:00", "2026-10-06"],
  ["d26117ab-4a7e-4d21-beeb-52e5dc0a4f39", "2026-10-04T12:46:44.224071+00:00", "2026-10-07"],
  ["b579ec58-68fa-485c-aa14-bcb9f0e7fe9e", "2026-10-04T12:47:31.638509+00:00", "2026-10-09"],
  ["d1e819b6-837d-4fd8-a80a-ac18183a4d22", "2026-10-04T12:48:02.273281+00:00", "2026-10-05"],
  ["83bb3d5c-a775-4c3f-8d56-0b1f7c079215", "2026-10-04T14:05:56.519236+00:00", "2026-10-08"],
  ["f9642635-0966-4740-89e6-e08223f9fe59", "2026-10-04T14:12:49.57149+00:00", "2026-10-08"],
  ["b2200d72-5f30-4bbf-99eb-d78e008f2f6c", "2026-10-11T05:16:45.032042+00:00", "2026-10-10"],
  ["e4a2c5a8-8e6b-49d9-9d6e-a5160ad33fae", "2026-10-27T16:29:55.645794+00:00", "2026-10-28"],
  ["a3b36f68-ec44-44fc-a064-47f760f59a5d", "2026-10-28T11:54:39.528667+00:00", "2026-11-01"],
]);
const SERVER_984A = [
  { month: "2026-10", n: 9, digest: 1689191294 },
  { month: "2026-11", n: 1, digest: 1495640778 },
];

const AIRFIX_SEPTEMBER = rows([["d16eccd7-a5f0-4e99-adb2-af641d1dcb97", "2026-10-15T08:57:42.621252+00:00", "2026-09-15"]]);
// Дробь из пяти и четырёх знаков — PostgREST режет хвостовые нули.
const OWNER_167B_NOVEMBER = rows([["8481272d-fb26-46d8-a712-a791e2cdd4af", "2026-10-28T09:12:05.749075+00:00", "2026-11-04"]]);

describe("отпечаток записей = отпечаток сервера", () => {
  test("микросекунды из строки PostgREST", () => {
    assert.equal(updatedAtMicros("2026-10-28T14:08:18.61043+00:00"), 1793196498610430n);
    assert.equal(updatedAtMicros("2026-10-28T14:08:18+00:00"), 1793196498000000n);
    assert.equal(updatedAtMicros("2026-10-28T16:08:18.61043+02:00"), 1793196498610430n);
    assert.equal(updatedAtMicros("2026-10-28T14:08:18.61043Z"), 1793196498610430n);
    assert.equal(updatedAtMicros("вчера"), null);
  });

  test("месяцы 984a — строка в строку с боевой функцией", () => {
    const local = monthDigests(OWNER_984A);
    assert.deepEqual(Object.fromEntries(local), {
      "2026-10": { n: 9, digest: 1689191294 },
      "2026-11": { n: 1, digest: 1495640778 },
    });
    assert.deepEqual(monthsToRefetch(local, SERVER_984A), []);
  });

  test("одиночные месяцы Air Fix и 167b — тоже", () => {
    assert.deepEqual(monthDigests(AIRFIX_SEPTEMBER).get("2026-09"), { n: 1, digest: 1332914090 });
    assert.deepEqual(monthDigests(OWNER_167B_NOVEMBER).get("2026-11"), { n: 1, digest: 1868035392 });
  });

  test("правка, удаление, новая и пропавшая запись — месяц на перечитку", () => {
    const edited = OWNER_984A.map((r, i) => (i === 0 ? { ...r, updated_at: "2026-10-29T08:00:00.1+00:00" } : r));
    assert.deepEqual(monthsToRefetch(monthDigests(edited), SERVER_984A), ["2026-10"]);
    assert.deepEqual(monthsToRefetch(monthDigests(OWNER_984A.slice(1)), SERVER_984A), ["2026-10"]);
    assert.deepEqual(monthsToRefetch(monthDigests(OWNER_984A.slice(0, 9)), SERVER_984A), ["2026-11"]);
    const extra = [...OWNER_984A, { ...AIRFIX_SEPTEMBER[0] }];
    assert.deepEqual(monthsToRefetch(monthDigests(extra), SERVER_984A), ["2026-09"]);
  });

  test("строка без читаемого updated_at портит свой месяц, а не совпадает", () => {
    const broken = OWNER_984A.map((r, i) => (i === 0 ? { ...r, updated_at: "" } : r));
    assert.deepEqual(monthsToRefetch(monthDigests(broken), SERVER_984A), ["2026-10"]);
    assert.equal(appointmentRowHash("не-uuid", "2026-10-28T14:08:18+00:00"), null);
  });

  test("SQL считает тем же модулем и множителями", () => {
    assert.ok(SQL, "нет миграции");
    for (const k of ["16777619", "805306457", "1610612741", "402653189", "201326611"]) {
      assert.ok(SQL.includes(`* ${k} % 2147483647`), k);
    }
    assert.match(SQL, /left\(a\.date, 7\)/);
    assert.match(SQL, /security invoker/);
    assert.match(SQL, /revoke all on function public\.appointment_month_digest\(uuid\) from public, anon;/);
    assert.match(SQL, /grant execute on function public\.appointment_month_digest\(uuid\) to authenticated;/);
    assert.match(SQL, /on public\.appointments \(tenant_id, updated_at, id\)/);
  });
});
