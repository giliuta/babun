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
    // Заметки пишутся через очередь (useJsonArrayWriter), но правило то же:
    // поле очищается ТОЛЬКО после подтверждённой записи.
    assert.match(notes, /const saved = await notes\.apply/);
    assert.match(notes, /if \(saved\)/);
    assert.match(object, /if \(ok\) router\.back\(\)/);
    assert.match(unit, /if \(ok\) router\.back\(\)/);
    assert.match(object, /Удалить объект/);
    assert.match(unit, /Удалить кондиционер/);
  });

  test("json-массивы клиента пишутся одной очередью из свежайшего значения", () => {
    // phones / locations / notes — каждый ОДНА jsonb-колонка: патч
    // перезаписывает массив целиком. Патч, собранный из снимка рендера,
    // затирает предыдущую правку, ответ на которую ещё в пути. Поэтому
    // источник — latest.current, а записи выстроены в цепочку. Механика одна
    // на все массивы: второй копии этой логики в проекте быть не должно.
    const writer = read("use-json-writer.ts");
    assert.match(writer, /latest\.current/);
    assert.match(writer, /chain\.current = run/);
    // Экраны и блоки не собирают массив сами.
    assert.doesNotMatch(
      read("../../../app/(dashboard)/clients/object.tsx"),
      /update\(\{\s*locations:/,
    );
    assert.doesNotMatch(
      read("../../../app/(dashboard)/clients/unit.tsx"),
      /update\(\{\s*locations:/,
    );
    assert.match(read("use-location-writer.ts"), /useJsonArrayWriter/);
    assert.match(read("ClientHeader.tsx"), /useJsonArrayWriter/);
    // Теги и заметки — те же jsonb-массивы: собственных копий механики быть
    // не должно, иначе расхождение вернётся с другой стороны.
    assert.match(read("blocks/MetaBlock.tsx"), /useJsonArrayWriter/);
    assert.match(read("blocks/NotesBlock.tsx"), /useJsonArrayWriter/);
    // Признак снимка рендера — сборка набора из client.tag_ids прямо в
    // обработчике тапа. Через писателя набор берётся из свежайшего значения.
    assert.doesNotMatch(
      read("blocks/MetaBlock.tsx"),
      /client\.tag_ids\.(filter|includes)\(/,
    );
  });

  test("обязательные имя и телефон защищены и на сохранённой карточке", () => {
    // Гейт существовал только при СОЗДАНИИ: на карточке имя стиралось в ноль,
    // а вместе с номером обнулялся phone_e164 — ключ, на котором держится
    // защита от дублей.
    const header = read("ClientHeader.tsx");
    assert.match(header, /if \(!e164\) return;/);
    assert.match(header, /v\.trim\(\)\s*\n?\s*\? update\(\{ full_name/);
  });
});
