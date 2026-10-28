import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildStats } from "@babun/shared/local/selectors/client-stats";
import { upcomingRecordsNote } from "./delete-words";

// УДАЛЁННЫЙ КЛИЕНТ ОСТАЁТСЯ В СВОИХ ЗАПИСЯХ (баг 7 владельца): удалили
// клиента с записью на будущее — календарь подписал её «Запись», а блок
// «Клиент» в записи позвал «Выбрать клиента», хотя `client_id` в базе жив.
// И вопрос «Удалить клиента?» о будущих записях молчал.

const here = dirname(fileURLToPath(import.meta.url));
const src = (path: string) => readFileSync(resolve(here, path), "utf8");

describe("вопрос «Удалить клиента?» говорит о будущих записях", () => {
  test("строка — только когда записи есть", () => {
    assert.equal(upcomingRecordsNote(0), "");
    assert.match(upcomingRecordsNote(2), /будущих записей: 2 — они останутся в календаре/);
  });

  test("сводка считает будущие неотменённые записи, сегодня — тоже", () => {
    const client = { id: "c1", full_name: "Клиент" } as never;
    const apt = (over: Record<string, unknown>) =>
      ({
        id: String(Math.random()),
        client_id: "c1",
        date: "2026-10-28",
        time_start: "10:00",
        status: "scheduled",
        kind: "work",
        total_amount: 0,
        payments: [],
        ...over,
      }) as never;
    const s = buildStats(
      client,
      [apt({}), apt({ date: "2026-11-02" }), apt({ date: "2026-11-03", status: "cancelled" }), apt({ date: "2026-10-01" })],
      undefined,
      "2026-10-28",
    );
    assert.equal(s.upcomingRecords, 2);
  });

  test("обе двери удаления — карточка и строка списка — ставят эту строку", () => {
    for (const file of ["card/card-menu-actions.ts", "list/use-list-row-actions.ts"]) {
      assert.match(src(file), /upcomingRecordsNote\(stats\?\.upcomingRecords \?\? 0\)/, file);
    }
  });
});

describe("имя удалённого клиента — в календаре и в записи, только подписью", () => {
  test("календарь берёт имена и из удалённых, с пометкой «удалён»", () => {
    const naming = src("../calendar/home/use-record-naming.ts");
    assert.match(naming, /useDeletedClientNames\(\)/);
    assert.match(naming, /\[name, "удалён"\]\.join\(" · "\)/);
  });

  test("форма записи подписывает удалённого, но клиентом формы он не становится", () => {
    const form = src("../appointments/book-form/use-book-form.ts");
    assert.match(form, /const client = useMemo\(\s*\(\) => clients\.find\(\(c\) => c\.id === clientId\) \?\? null/);
    assert.match(form, /deletedClientName = !client && clientId \? \(deletedNames\.get\(clientId\) \?\? null\) : null/);
    for (const body of ["WorkBody.tsx", "EventBody.tsx"]) {
      assert.match(src(`../appointments/book-form/${body}`), /deletedName=\{deletedClientName\}/, body);
    }
    assert.match(src("../appointments/ClientBlock.tsx"), /: deletedName \? \(/);
  });
});
