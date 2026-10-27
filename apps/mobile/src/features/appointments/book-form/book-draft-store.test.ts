import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { MemoryKVStorage, setStorage } from "@babun/shared/storage";
import { bookFormSource } from "./source-for-tests";
import {
  BOOK_DRAFT_TTL_MS,
  clearBookDraft,
  paramsWithDraft,
  readBookDraft,
  writeBookDraft,
  clearEditDraft,
  readEditDraft,
  writeEditDraft,
  type BookDraftSnapshot,
} from "./book-draft-store";

const NOW = 1_800_000_000_000;

const snap = (over: Partial<BookDraftSnapshot> = {}): BookDraftSnapshot => ({
  v: 1,
  savedAt: NOW,
  kind: "work",
  teamId: "team-a",
  clientId: "client-1",
  locationId: "loc-1",
  address: "Limassol 1",
  date: "2026-11-05",
  timeStart: "14:00",
  timeEnd: "15:30",
  durationTouched: true,
  durationByHand: false,
  serviceIds: ["svc-clean"],
  overrides: { "svc-clean": { qty: 2 } },
  masterId: null,
  customTotal: false,
  totalDraft: "",
  discountType: null,
  discountValue: "",
  recordVatMode: "none",
  recordVatRate: null,
  status: "scheduled",
  comment: "Ключ у соседки",
  eventTitle: "",
  eventColor: null,
  eventTypeId: null,
  eventNotes: "",
  eventAddress: "",
  eventUrl: "",
  eventReminderOffset: null,
  repeat: { kind: "none" },
  allDay: false,
  reminderOn: false,
  colorOverride: null,
  city: null,
  cityTouched: false,
  ...over,
});

describe("черновик новой записи на телефоне", () => {
  beforeEach(() => {
    // Свежее хранилище — каждый тест начинает с телефона без черновиков.
    setStorage(new MemoryKVStorage());
  });

  test("набранное переживает выгрузку экрана и поднимается следующим «Создать запись»", () => {
    writeBookDraft("tenant-1", snap());
    const back = readBookDraft("tenant-1", "work", NOW + 60_000);
    assert.deepEqual(back, snap());
  });

  test("номер новой записи едет в черновике — повтор после пересоздания формы не заводит дубль", () => {
    writeBookDraft("tenant-1", snap({ newRecordId: "rec-1" }));
    assert.equal(readBookDraft("tenant-1", "work", NOW + 60_000)?.newRecordId, "rec-1");
  });

  test("черновик записи не всплывает в «Создать событие» и в другой компании", () => {
    writeBookDraft("tenant-1", snap());
    assert.equal(readBookDraft("tenant-1", "event", NOW), null);
    assert.equal(readBookDraft("tenant-2", "work", NOW), null);
    assert.equal(readBookDraft(null, "work", NOW), null);
  });

  test("черновик старше суток не поднимается", () => {
    writeBookDraft("tenant-1", snap());
    assert.notEqual(readBookDraft("tenant-1", "work", NOW + BOOK_DRAFT_TTL_MS - 1), null);
    assert.equal(readBookDraft("tenant-1", "work", NOW + BOOK_DRAFT_TTL_MS), null);
  });

  test("создание и «Удалить черновик» стирают его", () => {
    writeBookDraft("tenant-1", snap());
    clearBookDraft("tenant-1");
    assert.equal(readBookDraft("tenant-1", "work", NOW), null);
  });

  test("поднятый черновик ведёт умолчания своими командой, клиентом, днём и часом", () => {
    const params = { teamId: "team-b", date: "2026-10-28", time_start: "09:00", from: "finances" };
    assert.deepEqual(paramsWithDraft(params, snap()), {
      teamId: "team-a",
      clientId: "client-1",
      locationId: "loc-1",
      date: "2026-11-05",
      time_start: "14:00",
      from: "finances",
    });
    assert.equal(paramsWithDraft(params, null), params);
  });

  test("проводка: создание и «Не сохранять» стирают черновик, форма его пишет", () => {
    const src = bookFormSource();
    // Стирание — сразу за успешным созданием, а не до него: упавшее
    // сохранение черновик оставляет.
    assert.match(src, /await booking\.save\([\s\S]{0,1500}?\}\);\s*onSaved\?\.\(\);/);
    assert.match(src, /overpayRequestRef\.current = null;\s*onSaved\?\.\(\);/);
    assert.match(src, /eventObjectNote\.discard\(\);\s*onDiscardDraft\?\.\(\);/);
    assert.match(src, /onSaved: draftMemory\.forget/);
    // Правка поднимается ПОСЛЕ снимка «как было»: хук стоит за `useLeaveGuard`.
    assert.match(src, /const guard = useLeaveGuard\(\{[\s\S]*?const editOpened = useRestoreEditDraft\(\{/);
    assert.match(src, /edit: editOpened,/);
    assert.match(src, /onDiscardDraft: draftMemory\.forget/);
    assert.match(src, /usePersistBookDraft\(\{/);
  });
});

describe("снимок правки записи (I-04)", () => {
  beforeEach(() => setStorage(new MemoryKVStorage()));
  const { v: _v, savedAt: _s, ...body } = snap();
  const edit = (over: Partial<{ id: string; base: string; savedAt: number }> = {}) => ({
    v: 1 as const,
    savedAt: NOW,
    id: "apt-1",
    base: "2026-10-27T10:00:00Z",
    snap: body,
    ...over,
  });

  test("поднимается только у той же записи в том же виде и свежим", () => {
    writeEditDraft("t1", edit());
    assert.equal(readEditDraft("t1", "apt-1", "2026-10-27T10:00:00Z", NOW + 1000)?.snap.comment, "Ключ у соседки");
    // Запись поменяли с другого телефона — снимок лёг бы поверх чужого.
    assert.equal(readEditDraft("t1", "apt-1", "2026-10-27T11:00:00Z", NOW), null);
    assert.equal(readEditDraft("t1", "apt-2", "2026-10-27T10:00:00Z", NOW), null);
    assert.equal(readEditDraft("t2", "apt-1", "2026-10-27T10:00:00Z", NOW), null);
    assert.equal(readEditDraft("t1", "apt-1", "2026-10-27T10:00:00Z", NOW + BOOK_DRAFT_TTL_MS), null);
  });

  test("стирается только своей записью и не задевает черновик новой", () => {
    writeEditDraft("t1", edit());
    writeBookDraft("t1", snap());
    clearEditDraft("t1", "apt-2");
    assert.ok(readEditDraft("t1", "apt-1", "2026-10-27T10:00:00Z", NOW));
    clearEditDraft("t1", "apt-1");
    assert.equal(readEditDraft("t1", "apt-1", "2026-10-27T10:00:00Z", NOW), null);
    assert.ok(readBookDraft("t1", "work", NOW));
  });
});
