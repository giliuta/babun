import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// FOR TESTS ONLY. Contract tests read the booking form's source as text; the
// form is the route `app/book/index.tsx` plus this folder, so they read both.

const here = dirname(fileURLToPath(import.meta.url));

/** `app/book/index.tsx` followed by every non-test source file of `book-form/`. */
export function bookFormSource(): string {
  const route = readFileSync(resolve(here, "../../../../app/book/index.tsx"), "utf8");
  const parts = readdirSync(here)
    .filter((name) => /\.tsx?$/.test(name))
    .filter((name) => !/\.test\.tsx?$/.test(name) && name !== "source-for-tests.ts")
    .sort()
    .map((name) => readFileSync(resolve(here, name), "utf8"));
  return [route, ...parts].join("\n");
}
