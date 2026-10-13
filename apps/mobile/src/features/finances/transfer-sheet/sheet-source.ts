// Test-only helper: the transfer sheet as source text. The entry
// `TransferSheet.tsx` wires hooks and steps that live in this folder, so
// source contracts read both — the entry first, then every non-test module
// here, sorted by name.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export function transferSheetSource(): string {
  const modules = readdirSync(here)
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== "sheet-source.ts")
    .sort()
    .map((name) => readFileSync(join(here, name), "utf8"));
  return [readFileSync(join(here, "../TransferSheet.tsx"), "utf8"), ...modules].join("\n");
}
