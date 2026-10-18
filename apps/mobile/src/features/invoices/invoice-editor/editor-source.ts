// Test-only helper: the invoice form as source text. The entry
// `InvoiceEditor.tsx` wires hooks and blocks that live in this folder, so
// source contracts read both — the entry first, then every non-test module
// here, sorted by name.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export function invoiceEditorSource(): string {
  const modules = readdirSync(here)
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== "editor-source.ts")
    .sort()
    .map((name) => readFileSync(join(here, name), "utf8"));
  return [readFileSync(join(here, "../InvoiceEditor.tsx"), "utf8"), ...modules].join("\n");
}
