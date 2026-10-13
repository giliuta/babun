// Test-only helper: never import it from app code (it reads the disk).
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROUTE = resolve(__dirname, "../../../../app/(dashboard)/(home)/index.tsx");

/** Source of the calendar tab as contract tests read it: the route file,
 *  then every module of `features/calendar/home/` (tests and this helper
 *  excluded) in file-name order. The screen's code lives in those modules,
 *  so a guard on "the calendar screen" must look at all of them. */
export function calendarScreenSource(): string {
  const modules = readdirSync(__dirname)
    .filter((name) => /\.tsx?$/.test(name))
    .filter((name) => !name.endsWith(".test.ts") && name !== "source-for-tests.ts")
    .sort();
  return [ROUTE, ...modules.map((name) => join(__dirname, name))]
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}
