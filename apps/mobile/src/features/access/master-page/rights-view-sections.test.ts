import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { AccessBlock, AccessLevel } from "../access-map";
import { viewSections } from "./rights-view-sections";

// СТРАНИЦЫ РАЗДЕЛОВ ДОСТУПА — БЛОКАМИ (владелец 30.09). Право стоит там, куда
// его поставил владелец, и только там: «Доходы и расходы» — в «Главном»
// «Календаря», а не второй строкой в «Финансах».

const block = (key: string, levels: AccessLevel[], position: number): AccessBlock => ({
  key,
  area: key.startsWith("finance") ? "finance" : key.startsWith("clients") ? "clients" : "calendar",
  scope: "calendar",
  levels,
  title: key,
  ownerOnly: false,
  live: true,
  position,
});

const REGISTRY: AccessBlock[] = [
  block("calendar.records", ["off", "read", "write"], 10),
  block("calendar.create", ["off", "write"], 20),
  block("calendar.events", ["off", "read", "write"], 25),
  block("calendar.move", ["off", "write"], 26),
  block("calendar.cancel", ["off", "write"], 28),
  block("record.color", ["off", "write"], 37),
  block("calendar.day_labels", ["off", "read", "write"], 60),
  block("calendar.schedule", ["off", "read", "write"], 75),
  block("finance.operations", ["off", "read", "write"], 110),
  block("finance.accounts", ["off", "read", "write"], 120),
];

const page = (group: "calendar" | "finance") =>
  viewSections({
    blocks: REGISTRY,
    levelOf: (b) => (b.key === "calendar.records" ? "read" : (b.levels[0] as AccessLevel)),
    activeId: "team-1",
    onlyCalendar: true,
    onlyCompany: false,
    group,
  }).map((section) => ({ title: section.title, keys: section.rows.map((row) => row.block.key) }));

describe("страница раздела доступа — блоками владельца", () => {
  test("«Календарь»: «Главное» с деньгами, «Записи» — записи, события, перенос, отмена", () => {
    assert.deepEqual(page("calendar"), [
      { title: "Главное", keys: ["calendar.day_labels", "finance.operations", "calendar.schedule"] },
      { title: "Записи", keys: ["calendar.records", "calendar.events", "calendar.move", "calendar.cancel"] },
    ]);
  });

  test("«Финансы»: «Доходов и расходов» здесь нет — они в «Календаре»", () => {
    assert.deepEqual(page("finance"), [{ title: "", keys: ["finance.accounts"] }]);
  });
});
