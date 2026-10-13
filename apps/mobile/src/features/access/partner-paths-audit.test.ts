import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { calendarScreenSource } from "@/features/calendar/home/source-for-tests";

// АУДИТ 11.10 «СОТРУДНИК ВИДИТ НЕ ТО» (владелец: «проверь всё, что может быть
// в таком плане… убедись, что во всех страницах такого рода бага не будет»).
// Каждая находка сверена на боевой от лица партнёра (giluta.d в AirFix).

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), "utf8");

test("услуги мастера — таблица по правам «Услуги» плюс проекция его записей (было 0 услуг в записи)", () => {
  const src = read("../services/queries.ts");
  assert.match(src, /if \(role === "master"\) \{\s*(\/\/[^\n]*\s*)*const \[table, own\] = await Promise\.all\(/);
});

test("ставка НДС сотруднику — из безопасного профиля, а не падение инвойса", () => {
  const src = read("../finances/vat-queries.ts");
  assert.match(src, /\.maybeSingle\(\);/);
  assert.match(src, /supabase\.rpc\("current_tenant_profile_safe"\)/);
});

test("«Типы объектов» из записи — по праву строки, а не по роли", () => {
  const src = read("../../../app/(shared)/object-types.tsx");
  assert.match(src, /export \{ default \} from "\.\.\/\(dashboard\)\/clients\/object-types";/);
  assert.doesNotMatch(src, /RoleCapabilityBoundary/);
});

test("правка клиента из записи — по блоку клиента, как пустит сервер", () => {
  const book = read("../../../app/book/index.tsx");
  assert.match(book, /const clientCan = useClientCardWritable\(client\);/);
  assert.doesNotMatch(book, /\bclientWritable\b/);
});

test("суммы в повестке — по праву «Сумма», а не по роли", () => {
  const home = calendarScreenSource();
  assert.match(home, /showAmounts=\{isCrew \? amountVisible : true\}/);
});
