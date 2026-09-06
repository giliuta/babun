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
    // Страницы объекта и техники удалены (2026-08-06): правка объекта живёт
    // листом, уровень техники снесён целиком. Правило осталось прежним и
    // проверяется на листе правки.
    const objectSheet = read("ObjectEditSheet.tsx");
    assert.match(screen, /Promise<boolean>/);
    assert.match(screen, /await updateClient\.mutateAsync\(patch\)/);
    // Заметка клиента — ОДНО поле (2026-09-06), привязанное к последней записи
    // журнала: пишет тем же писателем «свежайший массив + очередь» через
    // applyNoteEdit, а черновик держит useInlineNote — коммит на уходе с поля
    // и с экрана, набранное не теряется и не пишется дважды.
    assert.match(notes, /useJsonArrayWriter<ClientNote>\(list/);
    assert.match(notes, /applyNoteEdit\(all, next, boundId/);
    assert.match(notes, /useInlineNote<string \| null>\(/);
    assert.doesNotMatch(notes, /TextInput/);
    // Лист правки объекта пишет ТЕМ ЖЕ писателем и удаляет с подтверждением.
    assert.match(objectSheet, /writer: LocationWriter/);
    assert.match(objectSheet, /Удалить объект/);
    // Создание объекта уехало со страницы в лист снизу (2026-07-27). Правило
    // то же: форма пустеет ТОЛЬКО после подтверждённой записи, иначе набранный
    // адрес исчезал вместе с неудавшимся PATCH-ем.
    const sheet = read("ObjectSheet.tsx");
    assert.match(sheet, /const id = await writer\.addLocation\(/);
    assert.match(sheet, /if \(!id\) \{/);
    // Отказ записи выходит РАНЬШЕ очистки формы: сама очистка (сброс адреса и
    // заметки с сохранением выбранного типа) стоит уже за этой веткой.
    // Поля листа ОБЯЗАНЫ быть live: кнопка живёт в футере и фокус не снимает,
    // поэтому коммит по blur не наступает — набранный адрес не доезжал до
    // черновика, кнопка оставалась серой, «Готово» молча выбрасывало работу
    // (регресс 2026-07-27, найден прогоном персонажей).
    const addressRow = sheet.slice(
      sheet.indexOf('label="Адрес или ссылка"'),
      sheet.indexOf('label="Заметка"'),
    );
    assert.match(addressRow, /\n\s+live\n/);
    const afterGate = sheet.slice(sheet.indexOf("if (!id) {"));
    assert.match(afterGate, /return false;/);
    assert.match(afterGate, /setDraft\(\(d\) => \(\{ \.\.\.EMPTY_DRAFT/);
    // Дорога создания объекта ОДНА — лист. Лист правки не создаёт: ни
    // черновика, ни гейта «Готово» на нём быть не должно.
    assert.doesNotMatch(objectSheet, /locId === "new"/);
    assert.doesNotMatch(objectSheet, /saveDraft/);
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
    assert.doesNotMatch(read("ObjectEditSheet.tsx"), /update\(\{\s*locations:/);
    assert.doesNotMatch(
      read("blocks/ObjectsBlock.tsx"),
      /update\(\{\s*locations:/,
    );
    assert.match(read("use-location-writer.ts"), /useJsonArrayWriter/);
    // ПИСАТЕЛЬ `locations` — ОДИН НА КАРТОЧКУ. Листы получают его пропом:
    // собственный хук в каждом листе означал три очереди от трёх снимков
    // массива, и правка в одном листе откатывалась записью из другого.
    assert.match(read("ObjectSheet.tsx"), /writer: LocationWriter/);
    assert.doesNotMatch(read("ObjectSheet.tsx"), /useLocationWriter\(/);
    assert.doesNotMatch(read("ObjectEditSheet.tsx"), /useLocationWriter\(/);
    assert.match(read("ClientProfileBlocks.tsx"), /useLocationWriter\(/);
    assert.doesNotMatch(read("ObjectSheet.tsx"), /update\(\{\s*locations:/);
    assert.match(read("ClientHeader.tsx"), /useJsonArrayWriter/);
    // Теги и заметки — те же jsonb-массивы: собственных копий механики быть
    // не должно, иначе расхождение вернётся с другой стороны.
    // Теги переехали в «Личное» (владелец 2026-07-26: «теги на уровне
    // Личное, как метки»), заметки — там же внизу. Механика та же.
    assert.match(read("blocks/PersonalBlock.tsx"), /useJsonArrayWriter/);
    assert.match(read("blocks/NotesBlock.tsx"), /useJsonArrayWriter/);
    // Признак снимка рендера — сборка набора из client.tag_ids прямо в
    // обработчике тапа. Через писателя набор берётся из свежайшего значения.
    assert.doesNotMatch(
      read("blocks/PersonalBlock.tsx"),
      /client\.tag_ids\.(filter)\(/,
    );
  });

  test("обязательные имя и телефон защищены и на сохранённой карточке", () => {
    // Гейт существовал только при СОЗДАНИИ: на карточке имя стиралось в ноль,
    // а вместе с номером обнулялся phone_e164 — ключ, на котором держится
    // защита от дублей.
    const header = read("ClientHeader.tsx");
    // Телефон: неразбираемое значение не пишем (иначе обнулился бы ключ
    // дедупа phone_e164) и объясняем причину.
    assert.match(header, /if \(!e164\) \{/);
    assert.match(header, /Номер не распознан/);
    // Имя: пустое не пишем и говорим почему (раньше правка отклонялась молча).
    assert.match(header, /if \(v\.trim\(\)\) \{\s*\n\s*update\(\{ full_name/);
    assert.match(header, /toast\("Имя обязательно"/);
  });
});
