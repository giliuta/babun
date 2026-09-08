import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  documentGroupSummary,
  documentsCountLabel,
  groupClientDocuments,
} from "./client-documents";

const appointments = [
  { id: "a1", date: "2026-09-06", time_start: "11:30", serviceName: "A/C Cleaning" },
  { id: "a2", date: "2026-09-10", time_start: "09:00", serviceName: "Ремонт" },
  { id: "a3", date: "2026-08-01", time_start: "10:00", serviceName: "Пустая" },
];

describe("groupClientDocuments", () => {
  test("группы по записям, новые сверху, без записи — последней; пустые записи не считаются", () => {
    const groups = groupClientDocuments({
      appointments,
      attachments: [
        { id: "f1", appointment_id: "a1", mime_type: "application/pdf", created_at: "2026-09-06T12:00:00Z" },
        { id: "f2", appointment_id: null, mime_type: "image/jpeg", created_at: "2026-07-01T12:00:00Z" },
      ],
      visitPhotos: [
        { id: "p1", appointment_id: "a1", created_at: "2026-09-06T12:30:00Z" },
        { id: "p2", appointment_id: "a1", created_at: "2026-09-06T12:31:00Z" },
      ],
      invoices: [{ id: "i1", appointment_id: "a2", issued_on: "2026-09-10" }],
      receipts: [{ id: "r1", appointment_id: "a1", issued_on: "2026-09-06" }],
    });
    assert.deepEqual(groups.map((g) => g.key), ["a2", "a1", "client"]);
    const a1 = groups[1];
    assert.equal(a1.receipts, 1);
    assert.equal(a1.photos, 2);
    assert.equal(a1.files, 1);
    assert.equal(a1.total, 4);
    assert.equal(groups[2].date, "2026-07-01");
    assert.equal(groups[2].appointment, null);
  });

  test("документ удалённой записи считается «без записи»", () => {
    const groups = groupClientDocuments({
      appointments,
      attachments: [],
      visitPhotos: [],
      invoices: [{ id: "i1", appointment_id: "gone", issued_on: "2026-09-03" }],
      receipts: [],
    });
    assert.equal(groups.length, 1);
    assert.equal(groups[0].key, "client");
    assert.equal(groups[0].date, "2026-09-03");
  });

  test("подписи: бумаги первыми, склонения верные", () => {
    const [g] = groupClientDocuments({
      appointments,
      attachments: [
        { id: "f1", appointment_id: "a1", mime_type: "application/pdf", created_at: "2026-09-06T12:00:00Z" },
        { id: "f2", appointment_id: "a1", mime_type: "application/pdf", created_at: "2026-09-06T12:00:00Z" },
      ],
      visitPhotos: [{ id: "p1", appointment_id: "a1", created_at: "2026-09-06T12:30:00Z" }],
      invoices: [{ id: "i1", appointment_id: "a1", issued_on: "2026-09-06" }],
      receipts: [
        { id: "r1", appointment_id: "a1", issued_on: "2026-09-06" },
        { id: "r2", appointment_id: "a1", issued_on: "2026-09-06" },
      ],
    });
    assert.equal(documentGroupSummary(g), "2 чека · счёт · 1 фото · 2 файла");
    assert.equal(documentsCountLabel(11), "11 документов");
    assert.equal(documentsCountLabel(1), "1 документ");
    assert.equal(documentsCountLabel(3), "3 документа");
  });
});
