import { afterEach, describe, expect, test } from "bun:test";
import {
  WritesBlockedError,
  __resetWriteGuardForTests,
  assertWritesAllowed,
  isWritesBlockedError,
  setWriteGuard,
  writesBlocked,
} from "./write-guard";

// Засов режима «его глазами»: пока он опущен, ни один путь записи не должен
// работать — ни прямой запрос, ни офлайн-очередь.

afterEach(() => {
  __resetWriteGuardForTests();
});

describe("засов записи", () => {
  test("по умолчанию записывать можно", () => {
    expect(writesBlocked()).toBe(false);
    expect(() => assertWritesAllowed("insert clients")).not.toThrow();
  });

  test("опущенный засов бросает, говорит по-человечески и помнит дорогу", () => {
    setWriteGuard(() => true);
    expect(writesBlocked()).toBe(true);
    // Экраны печатают `message` как есть — там не место адресам функций.
    expect(() => assertWritesAllowed("insert clients")).toThrow(/просмотр/);
    try {
      assertWritesAllowed("insert clients");
    } catch (error) {
      expect((error as WritesBlockedError).detail).toBe("insert clients");
      expect((error as Error).message).not.toContain("insert clients");
    }
  });

  test("засов читается живым, а не снимком", () => {
    let on = false;
    setWriteGuard(() => on);
    expect(writesBlocked()).toBe(false);
    on = true;
    expect(writesBlocked()).toBe(true);
    on = false;
    expect(writesBlocked()).toBe(false);
  });

  test("отбитая запись узнаётся без instanceof", () => {
    // Модуль может оказаться в двух копиях (приложение и общий пакет), и
    // проверка по прототипу тогда врёт: узнаём по полю.
    expect(isWritesBlockedError(new WritesBlockedError("rpc issue_receipt"))).toBe(true);
    expect(isWritesBlockedError(new Error("сеть отвалилась"))).toBe(false);
    expect(isWritesBlockedError(null)).toBe(false);
    expect(isWritesBlockedError({ writesBlocked: true })).toBe(true);
  });
});
