// Test-only helper: the «Финансы» tab as source text. The route file is a thin
// layout and the screen's logic lives in this folder, so source contracts read
// both — the route first, then every non-test module here, sorted by name.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const FINANCES_ROUTE = join(here, "../../../../app/(dashboard)/finances/index.tsx");

export function financesScreenSource(): string {
  const modules = readdirSync(here)
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== "screen-source.ts")
    .sort()
    .map((name) => readFileSync(join(here, name), "utf8"));
  return [readFileSync(FINANCES_ROUTE, "utf8"), ...modules].join("\n");
}
