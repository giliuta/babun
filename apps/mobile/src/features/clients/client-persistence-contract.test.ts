import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { readModuleSource } from "@/lib/module-source";
import { clientCardSource } from "./card/source-for-tests";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) =>
  readFileSync(resolve(here, relative), "utf8");
// Components split into an entry and a parts folder (rule of 400 lines):
// negative guards read both, so moved code stays guarded.
const PARTS: Record<string, string> = {
  "blocks/ObjectsBlock.tsx": "blocks/objects-block",
  "ClientExtraContacts.tsx": "extra-contacts",
};
const readWithParts = (relative: string) =>
  readModuleSource(resolve(here, relative), PARTS[relative] && resolve(here, PARTS[relative]));

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
      /queryKey: clientKeys\.attachments\(tenantId, clientId\)/,
    );
  });

  test("inline note and object editors clear only after a confirmed save", () => {
    const screen = clientCardSource();
    const notes = read("blocks/NotesBlock.tsx");
    // Страниц объекта и техники нет: правка объекта живёт листом, уровня
    // техники нет. Правило проверяется на листе правки.
    const objectSheet = read("object-sheet/use-object-edit.ts");
    assert.match(screen, /Promise<boolean>/);
    assert.match(screen, /await updateClient\.mutateAsync\(patch\)/);
    // Заметка клиента — ОДНО поле, привязанное к последней записи
    // журнала: пишет тем же писателем «свежайший массив + очередь» через
    // applyNoteEdit, а черновик держит useInlineNote — коммит на уходе с поля
    // и с экрана, набранное не теряется и не пишется дважды.
    assert.match(notes, /useJsonArrayWriter<ClientNote>\(list/);
    assert.match(notes, /applyNoteEdit\(all, next, boundId/);
    assert.match(notes, /useInlineNote<string \| null>\(/);
    assert.doesNotMatch(notes, /TextInput/);
    // Лист правки объекта пишет ТЕМ ЖЕ писателем и удаляет с подтверждением.
    assert.match(objectSheet, /writer: LocationWriter/);
    // Заголовок вопроса (с числом визитов) — в `object-delete.ts`.
    assert.match(objectSheet, /confirmAction\(objectDeleteTitle\(visitsOnObject\(/);
    // Создание объекта — лист снизу. Форма пустеет ТОЛЬКО после подтверждённой
    // записи, иначе набранный адрес исчезал бы вместе с неудавшимся PATCH-ем.
    const sheet = read("ObjectSheet.tsx");
    const create = read("object-sheet/use-object-create.ts");
    assert.match(create, /const id = await writer\.addLocation\(/);
    assert.match(create, /if \(!id\) \{/);
    // Отказ записи выходит РАНЬШЕ очистки формы: сама очистка (сброс адреса и
    // заметки с сохранением выбранного типа) стоит уже за этой веткой.
    // ФОРМА ОБЪЕКТА ОДНА НА СОЗДАНИЕ И НА ПРАВКУ. Блоки живут в
    // `ObjectFields`, листы — тонкие двери со своим способом записи. Второй
    // формы того же объекта в продукте быть не должно: иначе «добавить» и
    // «править» разойдутся — до разных примитивов, разной подписи типа и
    // карты только в одном из двух.
    const fields = read("ObjectFields.tsx");
    // Лист один (`ObjectSheet` с режимом) — и тело в нём одно; режимы —
    // только хуки записи, своей разметки у них нет.
    assert.equal(sheet.match(/<ObjectFields\b/g)?.length, 1, "в листе объекта второе тело формы");
    for (const door of [sheet, objectSheet, create]) {
      assert.doesNotMatch(door, /<FieldRow/);
      assert.doesNotMatch(door, /<AddressDetailsToggle/);
      assert.doesNotMatch(door, /<ChoiceRow/);
    }
    // Поля формы ОБЯЗАНЫ быть live: кнопка живёт в футере и фокус не снимает,
    // поэтому коммит по blur не наступает — набранный адрес не доезжал до
    // черновика, кнопка оставалась бы серой, «Готово» молча выбрасывало бы
    // работу.
    const addressRow = fields.slice(
      fields.indexOf('label="Адрес"'),
      fields.indexOf("<AddressDetailsToggle"),
    );
    assert.match(addressRow, /\n\s+live\n/);
    const afterGate = create.slice(create.indexOf("if (!id) {"));
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
    // Источник — свежайшее значение очереди, записи — цепочкой.
    assert.match(writer, /fn\(storeRef\.current\.latest\)/);
    assert.match(writer, /st\.chain = run/);
    // ОЧЕРЕДЬ ОДНА НА КЛИЕНТА И ПОЛЕ: карточка и страница «Все
    // объекты» / «Все реквизиты» пишут один массив — очередь модульная.
    assert.match(writer, /const SHARED = new Map</);
    assert.match(read("use-location-writer.ts"), /ownerKey, "locations"\)/);
    assert.match(read("use-requisites-writer.ts"), /ownerKey, "requisites"\)/);
    assert.match(read("ClientObjectsSection.tsx"), /update,\s*\/\/[^\n]*\n\s*client\.id,\s*\)/);
    // Экраны и блоки не собирают массив сами.
    assert.doesNotMatch(read("object-sheet/use-object-edit.ts"), /update\(\{\s*locations:/);
    assert.doesNotMatch(
      readWithParts("blocks/ObjectsBlock.tsx"),
      /update\(\{\s*locations:/,
    );
    assert.match(read("use-location-writer.ts"), /useJsonArrayWriter/);
    // ПИСАТЕЛЬ `locations` — ОДИН НА КАРТОЧКУ. Листы получают его пропом:
    // собственный хук в каждом листе означал три очереди от трёх снимков
    // массива, и правка в одном листе откатывалась записью из другого.
    assert.match(read("ObjectSheet.tsx"), /writer: LocationWriter/);
    assert.doesNotMatch(read("ObjectSheet.tsx"), /useLocationWriter\(/);
    assert.doesNotMatch(read("object-sheet/use-object-edit.ts"), /useLocationWriter\(/);
    assert.match(read("ClientObjectsSection.tsx"), /useLocationWriter\(/);
    assert.doesNotMatch(read("ObjectSheet.tsx"), /update\(\{\s*locations:/);
    // Доп. номера уехали из шапки в свои строки (STORY-085) — механика та же.
    // Ищется ВЫЗОВ, а не слово: имя писателя стоит и в комментариях, и
    // сторож по слову молчал бы при удалённой механике.
    assert.match(read("ClientExtraContacts.tsx"), /useJsonArrayWriter<PhoneEntry>\(/);
    assert.doesNotMatch(read("ClientHeader.tsx"), /update\(\{\s*phones:/);
    // ЛЮДЕЙ ВНУТРИ КАРТОЧКИ НЕТ (STORY-085: все — клиенты, связаны друг с
    // другом). Списка `client.people` со своим писателем нет; связь живёт у
    // самого человека (`client.memberships`), и пишет её блок связей. Сторож
    // здесь не про «как пишем», а про «не вернулось»: список людей внутри карточки — это копия чужих контактов,
    // из-за которой номер жены жил в двух местах сразу.
    for (const file of ["ClientHeader.tsx", "ClientExtraContacts.tsx"]) {
      assert.doesNotMatch(readWithParts(file), /update\(\{\s*people:/);
    }
    // Теги и заметки — те же jsonb-массивы: собственных копий механики быть
    // не должно, иначе расхождение вернётся с другой стороны.
    // Теги стоят наверху карточки, как метки, заметки — внизу. Механика та
    // же.
    assert.match(read("ClientLabelTags.tsx"), /useJsonArrayWriter/);
    assert.match(read("blocks/NotesBlock.tsx"), /useJsonArrayWriter/);
    // Признак снимка рендера — сборка набора из client.tag_ids прямо в
    // обработчике тапа. Через писателя набор берётся из свежайшего значения.
    assert.doesNotMatch(
      read("ClientLabelTags.tsx"),
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
