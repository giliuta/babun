import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(resolve(here, relative), "utf8");

// ДЫРА 7 КРИТИКА: «КОММИТ РОЛИ НА РАЗМОНТИРОВАНИИ ВОСКРЕШАЕТ УБРАННУЮ СВЯЗЬ»
// (STORY-086).
//
// Порядок в жизни: свайп «Убрать» → патч без связи → строка размонтировалась
// → отложенный коммит роли записал связь обратно. Вся гонка укладывается в
// один кадр, снимок её не ловит (память сессии: «Снимок не ловит гонку»), и
// единственное доказательство здесь — чистое правило плюс мутант.
//
// Правило живёт в `LinkRow.tsx` рядом с эффектом, который его зовёт, а не
// отдельным файлом: разойтись им нельзя. Сторож поэтому ВЫНИМАЕТ ТЕЛО ИЗ
// ИСХОДНИКА и исполняет его — иначе он сторожил бы свою копию правила, а не
// то, что стоит в продукте. Импортировать `LinkRow` целиком нельзя: за ним
// тянется react-native, которого в node:test нет.

/** Тело `shouldCommitRoleOnUnmount` из живого `LinkRow.tsx`, исполняемое как
 *  есть. Заголовок с типами отбрасывается — в JS их всё равно нет. */
function ruleFromSource(): (a: {
  linkKey?: string;
  edited: boolean;
  removed: boolean;
}) => boolean {
  const src = read("LinkRow.tsx");
  const start = src.indexOf("export function shouldCommitRoleOnUnmount(");
  assert.notEqual(
    start,
    -1,
    "правило коммита роли пропало из LinkRow — связь можно воскресить",
  );
  // От конца заголовка (`): boolean {`) до закрывающей скобки объявления —
  // она стоит одна на своей строке у левого края.
  const bodyStart = src.indexOf("): boolean {", start);
  assert.notEqual(bodyStart, -1, "у правила сменилась подпись — сторож ослеп");
  const bodyEnd = src.indexOf("\n}", bodyStart);
  const body = src.slice(bodyStart + "): boolean {".length, bodyEnd);
  assert.match(body, /return/, "тело правила вынулось пустым");
  // Имена аргументов те же, что в деструктуризации: тело обращается к ним
  // напрямую, и переименование ключа уронит сторож ReferenceError-ом.
  //
  // `new Function` здесь не дыра: строка приходит из СОСЕДНЕГО ФАЙЛА ЭТОГО ЖЕ
  // репозитория, прочитанного по фиксированному пути, а не снаружи. Кто может
  // переписать `LinkRow.tsx`, тот и так правит код приложения — исполнять
  // чужое этому сторожу нечего. Снаружи в него не приходит ни байта.
  const fn = new Function(
    "linkKey",
    "edited",
    "removed",
    body,
  ) as (linkKey: string | undefined, edited: boolean, removed: boolean) => boolean;
  return ({ linkKey, edited, removed }) => fn(linkKey, edited, removed);
}

describe("коммит роли на размонтировании", () => {
  const shouldCommit = ruleFromSource();

  test("убранная связь НЕ дописывается обратно", () => {
    assert.equal(
      shouldCommit({ linkKey: "l1", edited: true, removed: true }),
      false,
      "отложенный коммит роли воскресил связь, которую только что убрали",
    );
  });

  test("незакоммиченная правка роли доезжает", () => {
    assert.equal(
      shouldCommit({ linkKey: "l1", edited: true, removed: false }),
      true,
      "слово роли терялось при уходе со страницы — ради этого коммит и заведён",
    );
  });

  test("поле не трогали — лишнего патча нет", () => {
    assert.equal(
      shouldCommit({ linkKey: "l1", edited: false, removed: false }),
      false,
      "каждый уход со страницы стоил бы запроса и перерисовки перечня",
    );
  });

  test("без ключа связи коммит не заводит новую", () => {
    assert.equal(
      shouldCommit({ linkKey: undefined, edited: true, removed: false }),
      false,
      "коммит на размонтировании ПРАВИТ существующую связь и никогда не создаёт",
    );
  });
});

// Правило без проводки мертво: строка должна знать свой ключ, а перечень —
// поднять флаг ПЕРЕД удалением. Оба конца сторожим в исходниках: чистой
// функции у них нет, есть порядок вызовов.
describe("проводка правила", () => {
  test("строка связи знает ключ САМОЙ связи", () => {
    assert.match(
      read("blocks/ClientLinksBlock.tsx"),
      /linkKey=\{item\.key\}/,
      "без ключа связи отложенный коммит молча не пишется — правило стало бы мёртвым",
    );
  });

  test("флаг поднимается ПЕРЕД удалением, а не после", () => {
    const block = read("blocks/ClientLinksBlock.tsx");
    const flag = block.indexOf("suppressRoleCommit(item.key)");
    const remove = block.indexOf("onRemove(item)");
    assert.notEqual(flag, -1, "перечень перестал подавлять коммит убранной связи");
    assert.notEqual(remove, -1, "у перечня пропало само удаление");
    assert.ok(
      flag < remove,
      "флаг поднят после удаления: строка успевает уйти и дописать связь обратно",
    );
  });

  test("эффект берёт `removed` из общего списка убранных, а не из пропа", () => {
    assert.match(
      read("LinkRow.tsx"),
      /const removed = !!linkKey && removedLinks\.delete\(linkKey\)/,
      "метка удаления читается мимо модульного списка — перечень и строка разошлись",
    );
  });
});
