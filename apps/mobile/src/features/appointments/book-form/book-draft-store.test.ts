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
    assert.match(src, /await booking\.save\([\s\S]{0,1500}?\}\);\s*onCreated\?\.\(\);/);
    assert.match(src, /eventObjectNote\.discard\(\);\s*if \(!isEdit\) onDiscardDraft\?\.\(\);/);
    assert.match(src, /onCreated: draftMemory\.forget/);
    assert.match(src, /onDiscardDraft: draftMemory\.forget/);
    assert.match(src, /usePersistBookDraft\(\{/);
  });
});
