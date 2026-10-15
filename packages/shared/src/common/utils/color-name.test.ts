import { describe, expect, test } from "bun:test";
import { colorName } from "./colors";

describe("colorName", () => {
  test("цвет набора — своим именем, регистр не важен", () => {
    expect(colorName("#dd9900")).toBe("Янтарный");
    expect(colorName("#DD9900")).toBe("Янтарный");
  });
  test("пусто — «Не красить»", () => {
    expect(colorName(null)).toBe("Не красить");
  });
  test("серый вне набора — «Серый», а не «Свой»", () => {
    expect(colorName("#8E8E93")).toBe("Серый");
  });
  test("цвет вне набора — ближайшим именем", () => {
    expect(colorName("#FF9500")).not.toBe("Свой");
    expect(colorName("#005BD3")).not.toBe("Свой");
  });
  test("не цвет вовсе — «Свой»", () => {
    expect(colorName("rgba(0,0,0,0.5)")).toBe("Свой");
  });
});
