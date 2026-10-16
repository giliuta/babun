import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

// Rule 8 of AGENTS.md: a comment explains why the code is the way it is now.
// History — dates, "owner said on 03.10", audit and session numbers — lives
// in commits, docs and memory. In code it ages into noise nobody can check,
// and it hides the actual reason. A decision of the owner that must be kept
// is written as a rule, without a date or a quote.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const DIRS = ["apps/mobile/src", "apps/mobile/app", "packages/shared/src"];
const SKIP = new Set(["node_modules", "database.types.ts"]);

/** Markers that only ever mean "when", never "why". */
const HISTORY = [
  /владел[а-я]* [0-3]?\d\.[01]\d/i,
  /\((?!(?:канон|правил)[а-я]* )(?:[а-я]+ )?(?:0?[1-9]|[12]\d|3[01])\.(?:0?[1-9]|1[0-2])(?:\.20\d\d)?\)/i,
  /\(20\d\d-[01]\d-[0-3]\d\)/,
  /аудит[а-я]* [0-3]?\d\.[01]\d/i,
  /сесси[а-я]* 0\d\d/i,
  /LOCKED 20\d\d/,
];

const COMMENT = /^\s*(?:\/\/|\/\*|\*|\{\/\*)/;

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* sources(full);
    else if (/\.tsx?$/.test(name)) yield full;
  }
}

describe("comments carry no history", () => {
  test("no dates, owner quotes with dates, audit or session numbers in comments", () => {
    const hits: string[] = [];
    for (const dir of DIRS) {
      for (const file of sources(path.join(ROOT, dir))) {
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (COMMENT.test(line) && HISTORY.some((re) => re.test(line))) {
              hits.push(`${path.relative(ROOT, file)}:${i + 1}`);
            }
          });
      }
    }
    assert.deepEqual(hits, []);
  });
});
