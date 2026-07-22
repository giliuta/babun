import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) =>
  readFileSync(resolve(here, relative), "utf8");

describe("client native persistence contract", () => {
  test("attachments use UUIDs, tenant-scoped cache keys and DB-returned delete paths", () => {
    const source = read("card-attachments.ts");
    assert.match(source, /return randomUuid\(\)/);
    assert.doesNotMatch(source, /`att_\$\{Date\.now\(\)\}/);
    assert.match(
      source,
      /\.delete\(\)[\s\S]*\.eq\("tenant_id", tenantId\)[\s\S]*\.select\("storage_path"\)[\s\S]*\.maybeSingle\(\)/,
    );
    assert.match(source, /remove\(\[deleted\.storage_path\]\)/);
    assert.doesNotMatch(
      source.slice(source.indexOf("async function deleteAttachment")),
      /remove\(\[attachment\.storage_path\]\)/,
    );
    assert.match(
      source,
      /queryKey: \["client-attachments", tenantId, clientId\]/,
    );
  });

  test("inline note and object editors clear only after a confirmed save", () => {
    const screen = read("../../../app/(dashboard)/clients/[id].tsx");
    const notes = read("blocks/NotesBlock.tsx");
    const objects = read("blocks/ObjectsBlock.tsx");
    assert.match(screen, /Promise<boolean>/);
    assert.match(screen, /await updateClient\.mutateAsync\(patch\)/);
    assert.match(notes, /const saved = await update/);
    assert.match(notes, /if \(saved\)/);
    assert.match(objects, /const saved = await update/);
    assert.match(objects, /if \(saved\) setDraft\(null\)/);
    assert.match(objects, /Удалить объект/);
    assert.match(objects, /Удалить кондиционер/);
  });
});
