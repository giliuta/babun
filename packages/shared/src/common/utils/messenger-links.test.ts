import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { instagramUrl, normalizeHandle, telegramUrl } from "./messenger-links";

// В поле логина чаще вставляют ссылку на профиль, чем сам ник: «Поделиться
// профилем» в Instagram и Telegram отдаёт именно ссылку. Ссылка, записанная
// как ник, давала адрес «instagram.com/https://…» — значок вёл в никуда.

describe("ник из ссылки на профиль", () => {
  test("ссылка Instagram — ник", () => {
    expect(normalizeHandle("https://www.instagram.com/artem_test/")).toBe("artem_test");
    expect(normalizeHandle("https://instagram.com/artem_test?igsh=abc123")).toBe("artem_test");
    expect(normalizeHandle("instagram.com/artem_test")).toBe("artem_test");
  });

  test("ссылка Telegram — ник", () => {
    expect(normalizeHandle("https://t.me/artem_test")).toBe("artem_test");
    expect(normalizeHandle("http://telegram.me/artem_test/")).toBe("artem_test");
  });

  test("ник с собачкой и без — как раньше", () => {
    expect(normalizeHandle("@artem_test")).toBe("artem_test");
    expect(normalizeHandle("  artem_test ")).toBe("artem_test");
    expect(normalizeHandle("@https://t.me/artem_test")).toBe("artem_test");
    expect(normalizeHandle(null)).toBe("");
  });

  test("ссылки мессенджеров строятся от ника", () => {
    expect(instagramUrl("https://www.instagram.com/artem_test/")).toBe("https://instagram.com/artem_test");
    expect(telegramUrl("https://t.me/artem_test", null)).toBe("https://t.me/artem_test");
  });

  test("поле карточки сохраняет ник тем же правилом", () => {
    const fields = readFileSync(
      resolve(import.meta.dir, "../../../../../apps/mobile/src/features/clients/contact-fields.ts"),
      "utf8",
    );
    expect(fields).toMatch(/const stripAt = \(v: string\): string => normalizeHandle\(v\);/);
  });
});
