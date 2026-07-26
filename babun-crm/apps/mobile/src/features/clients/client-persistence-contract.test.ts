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
    // Объекты и техника уехали с карточки на свои страницы (2026-07-26):
    // правило то же — уходим с экрана только после подтверждённой записи,
    // иначе набранное исчезает вместе с экраном.
    const object = read("../../../app/(dashboard)/clients/object.tsx");
    const unit = read("../../../app/(dashboard)/clients/unit.tsx");
    assert.match(screen, /Promise<boolean>/);
    assert.match(screen, /await updateClient\.mutateAsync\(patch\)/);
    assert.match(notes, /const saved = await update/);
    assert.match(notes, /if \(saved\)/);
    assert.match(object, /if \(ok\) router\.back\(\)/);
    assert.match(unit, /if \(ok\) router\.back\(\)/);
    assert.match(object, /Удалить объект/);
    assert.match(unit, /Удалить кондиционер/);
  });

  test("запись объектов идёт одной очередью из свежайшего массива", () => {
    // locations — одна jsonb-колонка: патч перезаписывает весь массив. Патч,
    // собранный из снимка рендера, затирает предыдущую правку, ответ на
    // которую ещё в пути. Поэтому источник — latest.current, а записи
    // выстроены в цепочку.
    const writer = read("use-location-writer.ts");
    assert.match(writer, /latest\.current/);
    assert.match(writer, /chain\.current = run/);
    assert.doesNotMatch(
      read("../../../app/(dashboard)/clients/object.tsx"),
      /update\(\{\s*locations:/,
    );
    assert.doesNotMatch(
      read("../../../app/(dashboard)/clients/unit.tsx"),
      /update\(\{\s*locations:/,
    );
  });
});
