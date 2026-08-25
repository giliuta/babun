import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { csvCell, csvDocument, csvTextCell, shareCsvFile } from "./share-csv";

describe("safe regional CSV", () => {
  test("quotes delimiters, quotes and line breaks without losing content", () => {
    assert.equal(csvCell('A; "B"\nC'), '"A; ""B""\nC"');
    assert.equal(
      csvDocument([[csvCell("Имя"), csvCell("Заметка")], [csvCell("Иван"), csvCell("строка")]]),
      "\uFEFFИмя;Заметка\r\nИван;строка",
    );
  });

  test("neutralizes formula prefixes but leaves ordinary values unchanged", () => {
    assert.equal(csvTextCell("=1+1"), "'=1+1");
    assert.equal(csvTextCell(" +35799111222"), "' +35799111222");
    assert.equal(csvTextCell("\n@SUM(A1:A2)"), '"\'\n@SUM(A1:A2)"');
    assert.equal(csvTextCell("Лимасол"), "Лимасол");
    assert.equal(csvTextCell(""), "");
  });
});

// ВЫГРУЗКА В БРАУЗЕРЕ.
//
// Ветка `shareCsvFile` для веба держится на порядке: ссылку кликают, а адрес
// отзывают СЛЕДУЮЩИМ тиком. Firefox и Safari читают blob уже после текущей
// задачи, поэтому синхронный revokeObjectURL забирает адрес раньше, чем
// скачивание успевает начаться, — файл не приходит вовсе. Порядок и проверяем.

type Anchor = {
  href: string;
  download: string;
  style: Record<string, string>;
  click: () => void;
  remove: () => void;
};

type WebRun = {
  events: string[];
  anchors: Anchor[];
  blobs: Blob[];
  createdUrls: string[];
  revokedUrls: string[];
};

/** Минимальные DOM-заглушки: ровно те четыре точки, которых касается код. */
async function runInFakeBrowser(
  body: (run: WebRun) => Promise<void>,
): Promise<WebRun> {
  const run: WebRun = {
    events: [],
    anchors: [],
    blobs: [],
    createdUrls: [],
    revokedUrls: [],
  };

  const globals = globalThis as unknown as { document?: unknown };
  const hadDocument = "document" in globals;
  const previousDocument = globals.document;
  const previousCreate = URL.createObjectURL;
  const previousRevoke = URL.revokeObjectURL;

  globals.document = {
    createElement(tag: string) {
      run.events.push(`createElement:${tag}`);
      const anchor: Anchor = {
        href: "",
        download: "",
        style: {},
        click: () => run.events.push("click"),
        remove: () => run.events.push("remove"),
      };
      run.anchors.push(anchor);
      return anchor;
    },
    body: {
      appendChild(node: Anchor) {
        run.events.push("appendChild");
        assert.equal(run.anchors.at(-1), node, "в DOM кладут созданную ссылку");
        return node;
      },
    },
  };
  URL.createObjectURL = (blob: Blob) => {
    run.events.push("createObjectURL");
    run.blobs.push(blob);
    const url = `blob:test/${run.createdUrls.length}`;
    run.createdUrls.push(url);
    return url;
  };
  URL.revokeObjectURL = (url: string) => {
    run.events.push("revokeObjectURL");
    run.revokedUrls.push(url);
  };

  try {
    await body(run);
  } finally {
    if (hadDocument) globals.document = previousDocument;
    else delete globals.document;
    URL.createObjectURL = previousCreate;
    URL.revokeObjectURL = previousRevoke;
  }
  return run;
}

/** Пропустить макрозадачу — тот самый «следующий тик», в который отложен отзыв. */
const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("выгрузка CSV в браузере", () => {
  test("ссылку создают, кликают и убирают, а адрес НЕ отзывают синхронно", async () => {
    const run = await runInFakeBrowser(async (state) => {
      await shareCsvFile({
        contents: "\uFEFFИмя;Долг\r\nИван;100",
        filename: "clients 2026-08-25",
        dialogTitle: "Клиенты",
      });

      // Промис уже разрешён — микрозадачи разобраны, макрозадачи ещё нет.
      assert.deepEqual(state.events, [
        "createObjectURL",
        "createElement:a",
        "appendChild",
        "click",
        "remove",
      ]);
      assert.deepEqual(
        state.revokedUrls,
        [],
        "revokeObjectURL синхронно — Firefox и Safari не успеют начать скачивание",
      );

      await nextTick();
      assert.deepEqual(state.revokedUrls, state.createdUrls, "адрес отзывают следующим тиком");
      assert.deepEqual(state.events.at(-1), "revokeObjectURL");
    });

    const anchor = run.anchors[0];
    assert.equal(anchor.href, run.createdUrls[0]);
    assert.equal(anchor.download, "clients-2026-08-25.csv", "имя файла с расширением и без пробелов");
    assert.equal(anchor.style.display, "none");

    const blob = run.blobs[0];
    assert.equal(blob.type, "text/csv;charset=utf-8");
    // ignoreBOM: обычный Blob.text() съедает метку порядка байт, а именно она
    // заставляет Excel открыть кириллицу без «кракозябр» — читаем как есть.
    const bytes = new TextDecoder("utf-8", { ignoreBOM: true }).decode(
      await blob.arrayBuffer(),
    );
    assert.equal(bytes, "\uFEFFИмя;Долг\r\nИван;100");
  });

  test("уже готовое имя .csv не удваивают", async () => {
    const run = await runInFakeBrowser(async () => {
      await shareCsvFile({
        contents: "a;b",
        filename: "Отчёт.csv",
        dialogTitle: "Отчёт",
      });
      await nextTick();
    });
    assert.equal(run.anchors[0].download, "-.csv");
  });
});
