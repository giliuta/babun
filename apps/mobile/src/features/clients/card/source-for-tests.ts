import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// FOR TESTS ONLY. Contract tests read the client card's source as text; the
// card is the route `app/(dashboard)/clients/[id].tsx` plus this folder.

const here = dirname(fileURLToPath(import.meta.url));

/** The card route followed by every non-test source file of `card/`. */
export function clientCardSource(): string {
  const route = readFileSync(resolve(here, "../../../../app/(dashboard)/clients/[id].tsx"), "utf8");
  const parts = readdirSync(here)
    .filter((name) => /\.tsx?$/.test(name))
    .filter((name) => !/\.test\.tsx?$/.test(name) && name !== "source-for-tests.ts")
    .sort()
    .map((name) => readFileSync(resolve(here, name), "utf8"));
  return [route, ...parts].join("\n");
}

/** The card page itself — for checks of order inside its markup. */
export function clientCardPageSource(): string {
  return readFileSync(resolve(here, "ClientCardPage.tsx"), "utf8");
}
