import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { createBlankClient, type Client, type ClientTag } from "@babun/shared/local/clients";
import type { ClientSource } from "./acquisition-source";
import {
  applyBulkEdit,
  bulkResultWords,
  bulkSourceOptions,
  bulkTagsOffered,
  canBulkEdit,
  parseBulkEditResult,
  sourceEdits,
  splitByRight,
  tagEdits,
  undoEdits,
} from "./bulk-edit";

// Теги, команда и источник сразу многим: кому правка положена, какие правки
// уходят на сервер одной пачкой и как отмена возвращает каждому его прежнее.

const client = (id: string, team: string | null, extra: Partial<Client> = {}): Client => ({
  ...createBlankClient({ id, full_name: id }),
  team_id: team,
  ...extra,
});

const tag = (id: string, team: string | null, hidden = false): ClientTag => ({
  id,
  name: id,
  color: "#000",
  team_id: team,
  hidden,
});

const src = (id: string, team: string, name: string, position = 0): ClientSource => ({
  id,
  tenant_id: "t1",
  team_id: team,
  name,
  position,
  key: null,
});

describe("право на поле у каждого выбранного", () => {
  test("своя база владельца — всё открыто, без правки карточек — ничего", () => {
    const own = client("a", "t1");
    assert.equal(canBulkEdit(own, "tags", true), true);
    assert.equal(canBulkEdit(own, "team", true), true);
    assert.equal(canBulkEdit(own, "source", false), false);
  });

  test("строка сотрудника — по блокам: тег, «Личное»; команду он не меняет", () => {
    const member = client("m", "t1", { blocks: { "clients.tags": "write", "clients.personal": "read" } });
    assert.equal(canBulkEdit(member, "tags", true), true);
    assert.equal(canBulkEdit(member, "source", true), false);
    assert.equal(canBulkEdit(member, "team", true), false);
  });

  test("пропущенные без права считаются числом", () => {
    const rows = [client("a", "t1"), client("b", "t1", { blocks: {} })];
    const { allowed, refused } = splitByRight(rows, "tags", true);
    assert.deepEqual(allowed.map((c) => c.id), ["a"]);
    assert.equal(refused, 1);
  });
});

describe("теги пачки", () => {
  const TAGS = [tag("общий", null), tag("свой", "t1"), tag("чужой", "t9"), tag("скрытый", "t1", true)];

  test("поставить — общие и теги команд выбранных, без скрытых", () => {
    const got = bulkTagsOffered(TAGS, [client("a", "t1")], "add", null);
    assert.deepEqual(got.map((t) => t.id), ["общий", "свой"]);
  });

  test("снять — только стоящие хоть у кого-то, в порядке каталога", () => {
    const rows = [client("a", "t1", { tag_ids: ["скрытый"] }), client("b", "t1", { tag_ids: ["общий"] })];
    assert.deepEqual(bulkTagsOffered(TAGS, rows, "remove", null).map((t) => t.id), ["общий", "скрытый"]);
  });

  test("правка — добавить в конец, главный тег не сдвигается; снять — убрать", () => {
    const c = client("a", "t1", { tag_ids: ["x", "y"] });
    const [add] = tagEdits([c], "add", ["z", "x"]);
    assert.deepEqual(add, { id: "a", add_tags: ["z", "x"] });
    assert.deepEqual(applyBulkEdit(c, add).tag_ids, ["x", "y", "z"]);
    const [remove] = tagEdits([c], "remove", ["x"]);
    assert.deepEqual(applyBulkEdit(c, remove).tag_ids, ["y"]);
  });
});

describe("источник пачки — строкой своей команды", () => {
  const SOURCES = [
    src("i1", "t1", "Instagram", 0),
    src("s1", "t1", "Сайт", 1),
    src("i2", "t2", "instagram ", 0),
  ];

  test("варианты — имена: «Instagram» двух команд — одна строка", () => {
    const got = bulkSourceOptions(SOURCES, [client("a", "t1"), client("b", "t2")], null);
    assert.deepEqual(got.map((o) => o.key), ["instagram", "сайт"]);
  });

  test("каждому — строка его команды; у команды нет имени — пропуск", () => {
    const rows = [client("a", "t1"), client("b", "t2")];
    assert.deepEqual(sourceEdits(rows, SOURCES, "instagram", null), {
      edits: [
        { id: "a", acquisition_source: "src:i1" },
        { id: "b", acquisition_source: "src:i2" },
      ],
      missing: 0,
    });
    const site = sourceEdits(rows, SOURCES, "сайт", null);
    assert.deepEqual(site.edits, [{ id: "a", acquisition_source: "src:s1" }]);
    assert.equal(site.missing, 1);
  });

  test("клиент без команды — команда по умолчанию, как на карточке", () => {
    const got = sourceEdits([client("a", null)], SOURCES, "instagram", "t2");
    assert.deepEqual(got.edits, [{ id: "a", acquisition_source: "src:i2" }]);
  });
});

describe("отмена и ответ сервера", () => {
  test("отмена несёт только изменённые поля; команды «никакой» не шлёт", () => {
    const result = parseBulkEditResult({
      changed: [
        { id: "a", before: { tag_ids: ["x"] } },
        { id: "b", before: { team_id: "t1", acquisition_source: "unknown" } },
        { id: "c", before: { team_id: null } },
      ],
      skipped: 2,
      unchanged: 1,
    });
    assert.equal(result.skipped, 2);
    assert.deepEqual(undoEdits(result), [
      { id: "a", tag_ids: ["x"] },
      { id: "b", team_id: "t1", acquisition_source: "unknown" },
    ]);
  });

  test("чужой ответ — как «никого не изменили»", () => {
    assert.deepEqual(parseBulkEditResult(null), { changed: [], skipped: 0, unchanged: 0 });
    assert.deepEqual(parseBulkEditResult({ changed: [{ before: {} }] }).changed, []);
  });

  test("тост называет число и пропущенных", () => {
    assert.deepEqual(bulkResultWords("tags", "add", 3, 0), { message: "Теги поставлены: 3", tone: "success" });
    assert.deepEqual(bulkResultWords("team", "add", 2, 1), {
      message: "Команда сменена: 2 · пропущено: 1",
      tone: "success",
    });
    assert.equal(bulkResultWords("source", "add", 0, 4).tone, "error");
    assert.equal(bulkResultWords("tags", "remove", 0, 0).message, "У выбранных уже так");
  });
});

// ── Сервер: та же дверь, что у карточки ──────────────────────────────

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
function migration(file: string): string {
  for (const dir of ["supabase/migrations", "supabase/parked"]) {
    const full = path.join(REPO_ROOT, dir, file);
    if (existsSync(full)) return readFileSync(full, "utf8").replace(/^\s*--.*$/gm, "");
  }
  assert.fail(`нет ${file} ни в migrations, ни в parked`);
}

describe("bulk_edit_clients", () => {
  const sql = migration("20261028153000_bulk_edit_clients.sql");

  test("права не переписаны: теги и источник — дверью карточки, команда — своей", () => {
    assert.match(sql, /perform public\.update_client_with_tags\(active_tenant, edit_client, patch, next_tags\)/);
    assert.match(sql, /perform public\.set_client_team\(edit_client, edit ->> 'team_id'\)/);
    assert.doesNotMatch(sql, /update public\.clients/i, "прямой правки строки мимо дверей нет");
  });

  test("отказ двери по клиенту — пропуск, а не обрыв пачки", () => {
    assert.match(sql, /when sqlstate '42501' or sqlstate 'P0002' or sqlstate '23503' then\s+skipped := skipped \+ 1/);
  });

  test("без входа функция закрыта", () => {
    assert.match(sql, /revoke all on function public\.bulk_edit_clients\(jsonb\) from public, anon;/);
    assert.match(sql, /grant execute on function public\.bulk_edit_clients\(jsonb\) to authenticated;/);
  });
});
