// Test-only helper: a module as source text for source contracts.
//
// A data layer split into a thin barrel `x.ts` plus a folder `x/` is read as
// one text — the barrel first, then every non-test module of the folder,
// sorted by name — so a contract keeps guarding the code wherever inside the
// folder it lives. A module without such a folder is read as is.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export function readModuleSource(file: string): string {
  const own = readFileSync(file, "utf8");
  const folder = file.replace(/\.tsx?$/, "");
  if (folder === file || !existsSync(folder) || !statSync(folder).isDirectory()) return own;
  const modules = readdirSync(folder)
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    .sort()
    .map((name) => readFileSync(join(folder, name), "utf8"));
  return [own, ...modules].join("\n");
}
