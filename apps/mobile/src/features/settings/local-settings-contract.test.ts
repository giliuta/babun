import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "local-settings.ts"),
  "utf8",
);

function section(start: string, end?: string): string {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing ${start}`);
  const to = end ? source.indexOf(end, from + start.length) : source.length;
  assert.notEqual(to, -1, `missing ${end}`);
  return source.slice(from, to);
}

describe("canonical settings cache contract", () => {
  test("personal event reads hide only transport or rolling-contract failures", () => {
    const read = section(
      "export function usePersonalEventTypes(teamId?: string | null)",
      "export function useSavePersonalEventTypes()",
    );
    assert.match(read, /isConfirmedNetworkUnavailable\(readError\)/);
    assert.match(read, /isMissingPersonalEventTypesContract\(readError\)/);
    assert.match(read, /throw error;/);
  });

  test("personal cache is written only after server success", () => {
    const personalSave = section("export function useSavePersonalEventTypes()");
    const personalBeforeSuccess = personalSave.slice(
      0,
      personalSave.indexOf("onSuccess:"),
    );
    assert.doesNotMatch(personalBeforeSuccess, /\bsavePersonalEventTypes\(/);
    assert.match(
      personalSave,
      /onSuccess:[\s\S]*safeSavePersonalEventTypes\(/,
    );
  });

  test("settings writes require canonical server confirmation", () => {
    const locationSave = section(
      "export function useSaveLocationLabels()",
      "// ─── Personal event types",
    );
    assert.doesNotMatch(
      locationSave,
      /isMissingLocationLabelsContract\(error\)[\s\S]*saveLocationLabels/,
    );
    assert.match(locationSave, /Типы объектов ещё не подключены на сервере/);
    assert.match(locationSave, /throw new Error\(error\.message\)/);

    const personalSave = section("export function useSavePersonalEventTypes()");
    assert.match(personalSave, /\.select\("id"\)/);
    assert.match(personalSave, /Сохранение типов событий не подтверждено сервером/);
  });
});
