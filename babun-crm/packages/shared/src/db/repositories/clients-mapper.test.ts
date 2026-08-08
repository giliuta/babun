import { describe, expect, test } from "bun:test";
import { rowToClient } from "./clients";
import type { Location } from "../../local/clients";

// МАППЕР ТЕРЯЕТ ПОЛЯ МОЛЧА — и это самая дорогая ошибка в проекте.
//
// `rowToClient` перечисляет поля объекта вручную (намеренно: не пускаем в
// домен мусор из JSON). Цена — забытое поле не падает и не подсвечивается
// типами: оно просто не читается, а следующая запись массива `locations`
// стирает его и в базе. Так однажды исчез график ТО, а 2026-08-07 —
// `serviceEveryMonths`, из-за чего статус «Пора обслужить» был вечно пуст.
//
// Тест держит контракт: КАЖДОЕ поле объекта, пришедшее из базы, обязано
// доехать до домена. Добавили поле в `Location` — оно появится здесь.

function rowWithLocation(loc: Record<string, unknown>) {
  return {
    id: "c1",
    tenant_id: "t1",
    full_name: "Клиент",
    phone: "+35799123456",
    locations: [loc],
    phones: [],
    notes: [],
    equipment: [],
    created_at: "2026-01-01T00:00:00Z",
  } as never;
}

const FULL_LOCATION: Required<
  Pick<
    Location,
    | "id"
    | "label"
    | "address"
    | "mapUrl"
    | "isPrimary"
    | "note"
    | "serviceEveryMonths"
  >
> = {
  id: "loc-1",
  label: "Вилла",
  address: "Ленина 1",
  mapUrl: "https://maps.example/pin",
  isPrimary: true,
  note: "код домофона 25",
  serviceEveryMonths: 3,
};

describe("rowToClient — объект клиента", () => {
  test("ни одно поле объекта не теряется по дороге из базы", () => {
    const [loc] = rowToClient(rowWithLocation(FULL_LOCATION)).locations;
    for (const [key, value] of Object.entries(FULL_LOCATION)) {
      expect(loc[key as keyof Location]).toEqual(value as never);
    }
  });

  test("интервал обслуживания доезжает и не подменяется", () => {
    const [loc] = rowToClient(
      rowWithLocation({ ...FULL_LOCATION, serviceEveryMonths: 12 }),
    ).locations;
    expect(loc.serviceEveryMonths).toBe(12);
  });

  test("объект без интервала остаётся без него, а не получает выдуманный", () => {
    const { serviceEveryMonths: _omit, ...withoutInterval } = FULL_LOCATION;
    void _omit;
    const [loc] = rowToClient(rowWithLocation(withoutInterval)).locations;
    expect(loc.serviceEveryMonths).toBeUndefined();
  });
});

// АРХИВ И КОРЗИНА РАЗЛИЧАЮТСЯ ТОЛЬКО ПАРОЙ ПОЛЕЙ. Потеряется purge_at в
// мапере — и «Недавно удалённые» станут вторым архивом: срок исчезнет, а
// ночная очистка перестанет находить, кого стирать.
describe("rowToClient — архив и корзина", () => {
  const base = {
    id: "c1",
    tenant_id: "t1",
    full_name: "Клиент",
    phone: "+35799123456",
    locations: [],
    phones: [],
    notes: [],
    equipment: [],
    created_at: "2026-01-01T00:00:00Z",
  };

  test("живой клиент — оба поля пусты", () => {
    const c = rowToClient(base as never);
    expect(c.deleted_at).toBeNull();
    expect(c.purge_at).toBeNull();
  });

  test("архивный: дата ухода есть, срока стирания нет", () => {
    const c = rowToClient({
      ...base,
      deleted_at: "2026-08-08T10:00:00Z",
    } as never);
    expect(c.deleted_at).toBe("2026-08-08T10:00:00Z");
    expect(c.purge_at).toBeNull();
  });

  test("в корзине: срок стирания доезжает до домена", () => {
    const c = rowToClient({
      ...base,
      deleted_at: "2026-08-08T10:00:00Z",
      purge_at: "2026-09-07T10:00:00Z",
    } as never);
    expect(c.purge_at).toBe("2026-09-07T10:00:00Z");
  });
});
