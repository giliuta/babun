import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// ВЛАДЕЛЕЦ 11.10: «брат создал клиента — у него не появилось, у меня
// появилось; потом пишет „клиент с этим номером есть“; запись залагала».
// Сотрудник завёл клиента из формы записи (создание шло окном сотрудника и
// прошло), а форма искала его «клиентами его записей» — у нового клиента
// записей нет, и форма его не находила. Сверено на боевой от лица брата:
// `list_member_clients` отдаёт клиента, `list_master_clients_safe` — нет.

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, "queries.ts"), "utf8");

test("вне вкладки сотрудник с открытой базой читает окном сотрудника плюс клиентов своих записей", () => {
  assert.match(src, /if \(!mirror && activeTenantId && activeRole === "master"\) \{/);
  assert.match(src, /if \(member\) return \{ \.\.\.scopeOf\(member\), withRecordClients: true,/);
  assert.match(src, /return withRecordClients\(listMemberClients\(bound\), listMasterClientsSafe\(supabase\)\);/);
  // Один клиент: окно, а если его там нет — дверь записей.
  assert.match(src, /if \(found \|\| !scope\.withRecordClients\) return found \?\? null;\s*return \(await listMasterClientsSafe\(supabase, id\)\)\[0\] \?\? null;/);
});

test("пока права едут — не рисуем «клиентов записей» и не прыгаем", () => {
  assert.match(src, /if \(myAccess\.isPending\) \{[\s\S]{0,200}ready: false,/);
});
