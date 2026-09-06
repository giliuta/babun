import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { pendingDocs, pendingMedia } from "./appointment-files";

describe("очередь файлов новой записи", () => {
  let n = 0;
  const makeId = () => `id-${++n}`;
  test("медиа: видео без превью, фото с превью", () => {
    const items = pendingMedia(
      [
        { uri: "file:///a.jpg", fileName: "a.jpg", mediaType: "image" },
        { uri: "file:///b.mov", fileName: "b.mov", mediaType: "video" },
      ],
      makeId,
    );
    assert.equal(items[0].previewUri, "file:///a.jpg");
    assert.equal(items[0].video, false);
    assert.equal(items[1].previewUri, null);
    assert.equal(items[1].video, true);
    assert.equal(items[1].kind, "media");
  });
  test("документы: имя из файла, без превью", () => {
    const [doc] = pendingDocs([{ uri: "file:///act.pdf", fileName: "Акт.pdf", mimeType: "application/pdf" }], makeId);
    assert.equal(doc.kind, "document");
    assert.equal(doc.name, "Акт.pdf");
    assert.equal(doc.previewUri, null);
  });
});
