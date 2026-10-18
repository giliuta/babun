import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// Migration file names are their version: `YYYYMMDDHHMMSS_name.sql`. The
// Supabase CLI keys its history by that number, so two files with one
// version — or an impossible time like hour 40 — break `supabase db push`.
// Several sessions write migrations at once, which is how duplicates
// appeared; this keeps them out.
const here = dirname(fileURLToPath(import.meta.url));
const NAME = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_[a-z0-9_]+\.sql$/;

function check(dir: string) {
  const files = readdirSync(resolve(here, dir)).filter((f) => f.endsWith(".sql"));
  const bad = files.filter((f) => {
    const m = NAME.exec(f);
    if (!m) return true;
    const [, , mo, d, h, mi, s] = m.map(Number);
    return mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59;
  });
  const versions = files.map((f) => f.slice(0, 14));
  const dup = versions.filter((v, i) => versions.indexOf(v) !== i);
  return { bad, dup };
}

describe("migration file names", () => {
  test("supabase/migrations: valid, unique 14-digit versions", () => {
    const { bad, dup } = check("../../../../supabase/migrations");
    assert.deepEqual(bad, []);
    assert.deepEqual(dup, []);
  });

  test("supabase/parked: same rule, and no clash with applied versions", () => {
    const parked = check("../../../../supabase/parked");
    assert.deepEqual(parked.bad, []);
    const applied = new Set(
      readdirSync(resolve(here, "../../../../supabase/migrations")).map((f) => f.slice(0, 14)),
    );
    const clash = readdirSync(resolve(here, "../../../../supabase/parked"))
      .filter((f) => f.endsWith(".sql") && applied.has(f.slice(0, 14)));
    assert.deepEqual(clash, []);
  });
});
