import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { AccessBlock, AccessLevel } from "../access-map";
import {
  matchedTemplate,
  parseTemplates,
  templateChanges,
  templateLevel,
  withTemplateChanges,
} from "./templates";

const block = (
  key: string,
  levels: AccessLevel[],
  scope: AccessBlock["scope"] = "calendar",
  live = true,
): AccessBlock => ({ key, area: "calendar", scope, levels, title: key, ownerOnly: false, live, position: 0 });

const REGISTRY: AccessBlock[] = [
  block("record.client", ["off", "read", "write"]),
  block("record.status", ["read", "write"]),
  block("clients", ["off", "read", "write"]),
  block("calendar.records", ["off", "read"], "calendar", false),
  block("company.sms_templates", ["off", "read", "write"], "company"),
];

describe("шаблоны доступа", () => {
  test("разбор строк: мусор в положениях отбрасывается, порядок по позиции", () => {
    const got = parseTemplates([
      { id: "b", name: "Старший", position: 2, levels: { clients: "write" } },
      { id: "a", name: "Мастер", position: 1, levels: { clients: "nope", "record.client": "read" } },
      { name: "без id" },
    ]);
    assert.deepEqual(got.map((t) => t.id), ["a", "b"]);
    assert.deepEqual(got[0]?.levels, { "record.client": "read" });
  });

  test("применение — только живые блоки команды; нет положения — умолчание", () => {
    const changes = templateChanges(REGISTRY, { levels: { "record.client": "write" } }, "T1");
    assert.deepEqual(changes, [
      { block: "record.client", team_id: "T1", level: "write" },
      { block: "record.status", team_id: "T1", level: "read" },
      { block: "clients", team_id: "T1", level: "off" },
    ]);
  });

  test("чужое положение блока — умолчание", () => {
    assert.equal(templateLevel({ levels: { "record.status": "off" } }, REGISTRY[1]!), "read");
  });

  test("узнаёт шаблон, по которому стоят права; правка строки — «свои»", () => {
    const templates = parseTemplates([
      { id: "m", name: "Мастер", position: 0, levels: { "record.client": "read" } },
      { id: "s", name: "Старший", position: 1, levels: { "record.client": "write", clients: "read" } },
    ]);
    const now: Record<string, AccessLevel> = { "record.client": "write", "record.status": "read", clients: "read" };
    const read = (b: AccessBlock) => now[b.key] ?? b.levels[0]!;
    assert.equal(matchedTemplate(REGISTRY, read, templates)?.id, "s");
    now.clients = "off";
    assert.equal(matchedTemplate(REGISTRY, read, templates), null);
  });

  test("правка строки шаблона меняет только её и зависимых", () => {
    const next = withTemplateChanges({ levels: { clients: "read", "record.client": "read" } }, [
      { block: "clients", team_id: "x", level: "off" },
    ]);
    assert.deepEqual(next, { clients: "off", "record.client": "read" });
  });
});
