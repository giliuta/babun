import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// КРОМКА СВАЙПА ЗАКРЕПЛЕНА ЗА СМЫСЛОМ, А НЕ ЗА СИЛОЙ ДЕЙСТВИЯ.
//
// Владелец 2026-08-29: «удалить справа, скрыть слева, а не наоборот».
// Владелец 2026-09-10: «свайп вправо — это удалить, а не скрыть».
//
// Закон уже был — но лежал КОММЕНТАРИЕМ в одном экране (`cabinet/services`), и
// следующий заход вывел из него собственное правило «правая кромка несёт самое
// сильное из доступного этой строке». По нему у стандартной категории справа
// оказалось «Скрыть», у своей — «Удалить»: один жест на соседних строках делал
// разное, и первый же тап по стандартной строке (она тоже скрывала) убрал у
// владельца «Налоги и сборы» из списка.
//
// Поэтому закон живёт тестом:
//   ПРАВАЯ (`label`)   — «Удалить», «Убрать» и только они;
//   ЛЕВАЯ (`leading`)  — состояние: «Скрыть», «Показать», «Вернуть», «Открыть»;
//   нечего удалять     — правой кромки нет вовсе (`label`/`onAction` опущены);
//   тап по строке      — правка, а не смена состояния.
//
// Исключение ровно одно и названо здесь по имени: `/accounts` — на этом экране
// разрушительного действия нет НИ У ОДНОЙ строки (счёт закрывают в карточке), и
// правая кромка отдана главному действию списка — «Перевести».

const here = dirname(fileURLToPath(import.meta.url));
/** `apps/mobile` */
const app = resolve(here, "../../..");
const repo = resolve(app, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Строки-комментарии убираем: в них законно живут и «Скрыть», и «>». */
function withoutLineComments(src: string): string {
  return src
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

/** Текст открывающего тега `<SwipeRow …>` — до его собственного `>`. */
function openingTags(src: string): string[] {
  const out: string[] = [];
  const TAG = "<SwipeRow";
  for (let i = src.indexOf(TAG); i !== -1; i = src.indexOf(TAG, i + 1)) {
    let depth = 0;
    let j = i + TAG.length;
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      else if (c === ">" && depth === 0) break;
    }
    out.push(src.slice(i, j));
  }
  return out;
}

/** Делит пропы тега на две кромки: `leading={{ … }}` и всё остальное. */
function edges(tag: string): { trailing: string; leading: string } {
  const k = tag.indexOf("leading=");
  if (k === -1) return { trailing: tag, leading: "" };
  const start = tag.indexOf("{", k);
  let depth = 0;
  let j = start;
  for (; j < tag.length; j++) {
    if (tag[j] === "{") depth += 1;
    else if (tag[j] === "}") {
      depth -= 1;
      if (depth === 0) {
        j += 1;
        break;
      }
    }
  }
  return { trailing: tag.slice(0, k) + tag.slice(j), leading: tag.slice(start, j) };
}

/** Подписи кнопок — литералы у `label` (в JSX-пропе и в объекте `leading`). */
function labels(edge: string): string[] {
  const out: string[] = [];
  const re = /\blabel\s*[=:]\s*([^,\n]*(?:\n[^,\n]*)?)/g;
  for (const m of edge.matchAll(re)) {
    for (const lit of m[1].matchAll(/"([^"]+)"/g)) out.push(lit[1]);
  }
  return out;
}

const DESTRUCTIVE = ["Удалить", "Убрать"];
const STATE = ["Скрыть", "Показать", "Вернуть", "Открыть"];
/** Экраны, где разрушительного нет ни у одной строки (см. шапку). */
const PRIMARY_ACTION_SCREENS = new Map([["app/accounts/index.tsx", "Перевести"]]);

const files = [...walk(join(app, "app")), ...walk(join(app, "src"))].filter(
  (f) => !f.endsWith("swipe-edge-contract.test.ts"),
);

describe("кромки свайпа", () => {
  test("справа только разрушительное, состояние — слева", () => {
    let seen = 0;
    for (const file of files) {
      const raw = readFileSync(file, "utf8");
      if (!raw.includes("<SwipeRow")) continue;
      const rel = relative(app, file);
      const allowed = PRIMARY_ACTION_SCREENS.get(rel);
      for (const tag of openingTags(withoutLineComments(raw))) {
        seen += 1;
        const { trailing, leading } = edges(tag);
        // СПРЕД ПРОПОВ ЗАПРЕЩЁН. Первый заход развесил кромки именно так:
        // `{...(own ? { label: "Удалить", …, leading: hide } : hide)}` — и
        // слово «Скрыть» уехало на правую кромку внутри переменной, где его не
        // видно ни глазом, ни грепом. Кромки задаются явными пропами.
        assert.ok(
          !trailing.includes("{..."),
          `${rel}: пропы <SwipeRow> собраны спредом. Пиши явно: label / color / icon / onAction — правая кромка, leading — левая; иначе слово кромки не видно в месте, где оно решается.`,
        );
        const words = labels(trailing);
        if (/\blabel\s*=/.test(trailing)) {
          assert.ok(
            words.length > 0,
            `${rel}: подпись правой кромки спрятана в переменной. Слово пишется литералом в теге — «Удалить» или «Убрать».`,
          );
        }
        for (const word of words) {
          assert.ok(
            !STATE.includes(word),
            `${rel}: «${word}» на ПРАВОЙ кромке. Состояние строки живёт на левой (leading) — правая закреплена за «Удалить»/«Убрать». Нечего удалять — правой кромки нет вовсе (label/onAction необязательны).`,
          );
          assert.ok(
            DESTRUCTIVE.includes(word) || allowed === word,
            `${rel}: «${word}» на ПРАВОЙ кромке. Там живёт только «Удалить»/«Убрать»; главное действие списка допустимо лишь на экране без разрушительных действий вовсе (см. PRIMARY_ACTION_SCREENS).`,
          );
        }
        for (const word of labels(leading)) {
          assert.ok(
            !DESTRUCTIVE.includes(word),
            `${rel}: «${word}» на ЛЕВОЙ кромке. Разрушительное — только справа, иначе жест возврата удаляет.`,
          );
        }
      }
    }
    // Без этого тест зеленел бы и на пустом списке файлов.
    assert.ok(seen >= 10, `нашлось всего ${seen} <SwipeRow> — обход сломан`);
  });

  test("тап по строке не меняет состояние молча", () => {
    for (const file of files) {
      const raw = readFileSync(file, "utf8");
      const rel = relative(app, file);
      for (const m of withoutLineComments(raw).matchAll(
        /onPress=\{[^}]{0,200}?\}/g,
      )) {
        assert.ok(
          !/\b(toggleHidden|setHidden|toggleActive)\b/.test(m[0]),
          `${rel}: тап по строке меняет состояние (${m[0].slice(0, 60)}…). Тап открывает ПРАВКУ; скрыть/вернуть — кромка и ротор.`,
        );
      }
    }
  });

  test("правая кромка у примитива необязательна", () => {
    const src = readFileSync(join(app, "src/components/ui/SwipeRow.tsx"), "utf8");
    for (const need of [
      "label?: string;",
      "onAction?: () => void;",
      "const hasTrailing = !!onAction && !!label;",
      "{hasTrailing ? (",
      "latest.current?.();",
    ]) {
      assert.ok(
        src.includes(need),
        `SwipeRow.tsx: пропало «${need}» — без этого у строки без удаления снова появится чужая правая кромка`,
      );
    }
    // Ход влево без правой кромки обязан упираться в ноль.
    assert.match(src, /const low = !hasTrailing\s*\n?\s*\? 0/);
  });

  test("скрытая категория падает вниз и не приходит в выбор", () => {
    const screen = readFileSync(
      join(app, "app/(dashboard)/cabinet/categories.tsx"),
      "utf8",
    );
    assert.match(screen, /sort\(\(a, b\) => Number\(a\.hidden\) - Number\(b\.hidden\)\)/);
    for (const [file, hint] of [
      ["src/features/finances/OperationSheet.tsx", "лист операции"],
      ["app/(dashboard)/cabinet/templates.tsx", "шаблоны операций"],
    ] as const) {
      const src = readFileSync(join(app, file), "utf8");
      assert.match(
        src,
        /!c\.hidden \|\| c\.id === categoryId/,
        `${file} (${hint}): скрытая категория обязана исчезать из выбора — кроме уже выбранной в этой операции`,
      );
    }
    const debt = readFileSync(join(app, "src/features/finances/use-debt-draft.ts"), "utf8");
    assert.ok(debt.includes("!c.hidden"), "долги: скрытая категория не предлагается");
  });

  test("закон записан в каноне", () => {
    const agents = readFileSync(join(repo, "AGENTS.md"), "utf8");
    const ds = readFileSync(join(app, "docs/DESIGN-SYSTEM.md"), "utf8");
    const blocks = readFileSync(join(app, "docs/BLOCKS.md"), "utf8");
    for (const [name, text] of [
      ["AGENTS.md", agents],
      ["DESIGN-SYSTEM.md", ds],
      ["BLOCKS.md", blocks],
    ] as const) {
      assert.ok(
        text.includes("swipe-edge-contract.test.ts"),
        `${name}: закон кромок обязан ссылаться на свой тест`,
      );
    }
    assert.ok(
      !ds.includes("правая кромка несёт самое сильное"),
      "DESIGN-SYSTEM.md: ошибочная формулировка «самое сильное из доступного» вернулась",
    );
  });
});
