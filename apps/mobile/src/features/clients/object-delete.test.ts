import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { objectDeleteTitle, visitsOnObject } from "./object-delete";

test("число визитов — только на этом объекте; не загрузились — неизвестно", () => {
  const visits = [{ location_id: "a" }, { location_id: "b" }, { location_id: "a" }, { location_id: null }];
  assert.equal(visitsOnObject(visits, "a"), 2);
  assert.equal(visitsOnObject(visits, "c"), 0);
  assert.equal(visitsOnObject(undefined, "a"), null);
});

test("вопрос называет записи, когда они есть", () => {
  assert.equal(objectDeleteTitle(1), "На объекте 1 запись — удалить?");
  assert.equal(objectDeleteTitle(3), "На объекте 3 записи — удалить?");
  assert.equal(objectDeleteTitle(5), "На объекте 5 записей — удалить?");
  assert.equal(objectDeleteTitle(0), "Удалить объект?");
  assert.equal(objectDeleteTitle(null), "Удалить объект?");
});

test("лист объекта спрашивает этим заголовком", () => {
  const sheet = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "object-sheet/use-object-edit.ts"), "utf8");
  assert.match(sheet, /confirmAction\(objectDeleteTitle\(visitsOnObject\(clientVisits\.data, victim\.id\)\), \{/);
  assert.match(sheet, /const clientVisits = useClientAppointments\(client\.id\);/);
});
