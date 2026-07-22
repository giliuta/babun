import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, test } from "vitest";

const config = readFileSync(
  resolve(process.cwd(), "supabase/config.toml"),
  "utf8",
);

function functionSection(name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = config.match(
    new RegExp(`\\[functions\\.${escaped}\\]([\\s\\S]*?)(?=\\n\\[|$)`),
  );
  assert.ok(match, `Missing Supabase config for ${name}`);
  return match[1];
}

describe("Edge Function gateway authorization config", () => {
  test("allows database dispatchers through to their own secret checks", () => {
    assert.match(functionSection("send_sms"), /verify_jwt\s*=\s*false/);
    assert.match(functionSection("send_push"), /verify_jwt\s*=\s*false/);
  });

  test("keeps the mobile account deletion endpoint behind user JWT", () => {
    assert.match(functionSection("account-delete"), /verify_jwt\s*=\s*true/);
  });

  test("lets only the separately authenticated cleanup worker bypass JWT", () => {
    assert.match(
      functionSection("account-delete-cleanup"),
      /verify_jwt\s*=\s*false/,
    );
  });
});
