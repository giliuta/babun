import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// FOR TESTS ONLY. Contract tests read the clients list's source as text; the
// list is the route `app/(dashboard)/clients/index.tsx` plus this folder.

const here = dirname(fileURLToPath(import.meta.url));

/** The list route followed by every non-test source file of `list/`. */
export function clientsListSource(): string {
  const route = readFileSync(resolve(here, "../../../../app/(dashboard)/clients/index.tsx"), "utf8");
  const parts = readdirSync(here)
    .filter((name) => /\.tsx?$/.test(name))
    .filter((name) => !/\.test\.tsx?$/.test(name) && name !== "source-for-tests.ts")
    .sort()
    .map((name) => readFileSync(resolve(here, name), "utf8"));
  return [route, ...parts].join("\n");
}

/** The list's top bar (search, settings, filters, team ribbon) alone. */
export function clientsListTopBarSource(): string {
  return readFileSync(resolve(here, "ListTopBar.tsx"), "utf8");
}
