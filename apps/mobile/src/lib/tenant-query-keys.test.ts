import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { myMembershipsQueryKey } from "../features/settings/my-memberships-key";
import { querySurvivesSwitch } from "./tenant-query-keys";

// СВОИ ЧЛЕНСТВА ПЕРЕЖИВАЮТ ПЕРЕХОД. По ним вкладка «Клиенты» находит компанию,
// где человек владелец. Снеси их чистка на каждом переходе — вкладка мигала бы
// ожиданием после каждого тапа по чипу, а без сети не знала бы своей компании.

const COMPANY = "11111111-1111-4111-8111-111111111111";

const source = (file: string) =>
  readFileSync(join(__dirname, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
    .replace(/\s+/g, " ");

describe("свои членства и переход между компаниями", () => {
  test("ключ членств не называет компанию, но переход его бережёт", () => {
    assert.equal(querySurvivesSwitch(myMembershipsQueryKey("user-1"), [COMPANY]), true);
  });

  test("ключ без компании, который не принадлежит человеку, сносится", () => {
    assert.equal(querySurvivesSwitch(["client", "c-1"], [COMPANY]), false);
  });

  test("выселение компании перечитывает свои членства", () => {
    assert.match(
      source("evict-company.ts"),
      /void queryClient\.invalidateQueries\(\{ queryKey: myMembershipsQueryKey\(userId\) \}\);/,
    );
  });
});
