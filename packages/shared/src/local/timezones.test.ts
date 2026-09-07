import { describe, expect, test } from "bun:test";
import { ZONE_GROUPS, TIMEZONE_OPTIONS } from "./timezones";

// СПИСОК ПОЯСОВ РЕШАЕТ, КОГДА У БИЗНЕСА КОНЧАЕТСЯ ДЕНЬ.
//
// Он сгенерирован из ICU, а значит может молча разъехаться при обновлении
// данных о переводе часов. Эти проверки ловят ровно то, что дорого стоит:
// невалидную зону (экран падает) и две группы с ОДИНАКОВЫМ поведением —
// признак, что группировка развалилась и человек выбирает из дублей.

function offsetMinutes(zone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUTC = Date.UTC(
    g("year"),
    g("month") - 1,
    g("day"),
    g("hour") % 24,
    g("minute"),
  );
  return Math.round((asUTC - at.getTime()) / 60000);
}

/** Отпечаток поведения зоны за год — 365 проб, по одной на день.
 *  Именно посуточно, а не по месяцам: помесячная сверка не видела, что
 *  Иерусалим переводит часы не в тот же день, что ЕС, и сваливала их
 *  в одну группу. */
const signature = (zone: string) =>
  Array.from({ length: 365 }, (_, d) =>
    offsetMinutes(zone, new Date(Date.UTC(2026, 0, 1, 12) + d * 86400000)),
  ).join(",");

describe("группы часовых поясов", () => {
  test("список не пуст и обозрим — барабан, а не простыня", () => {
    expect(ZONE_GROUPS.length).toBeGreaterThan(30);
    expect(ZONE_GROUPS.length).toBeLessThan(90);
  });

  test("каждая зона валидна для Intl", () => {
    for (const g of ZONE_GROUPS) {
      expect(() =>
        new Intl.DateTimeFormat("en-US", { timeZone: g.zone }).format(new Date()),
      ).not.toThrow();
    }
  });

  test("представитель группы назван среди её городов", () => {
    for (const g of ZONE_GROUPS) {
      expect(g.cities.some((c) => c.zone === g.zone)).toBe(true);
    }
  });

  test("каждый город группы валиден и ведёт себя как её представитель", () => {
    // Город хранит СВОЮ зону: киевлянину сохраняется Europe/Kyiv, а не
    // Europe/Helsinki. Она обязана совпадать с группой во все 365 дней —
    // иначе выбор своего города молча сдвинул бы человеку сутки.
    for (const g of ZONE_GROUPS) {
      const groupSig = signature(g.zone);
      for (const c of g.cities) {
        expect(() =>
          new Intl.DateTimeFormat("en-US", { timeZone: c.zone }).format(new Date()),
        ).not.toThrow();
        expect(signature(c.zone)).toBe(groupSig);
      }
    }
  });

  test("устаревших имён зон не осталось", () => {
    // ICU по старой памяти отдаёт Europe/Kiev, Asia/Calcutta, Asia/Saigon и
    // ещё девять. Человеку показывать их нельзя, хранить — тем более.
    const STALE = [
      "Europe/Kiev",
      "Asia/Calcutta",
      "Asia/Rangoon",
      "Asia/Saigon",
      "Asia/Katmandu",
      "America/Godthab",
      "Africa/Asmera",
      "Atlantic/Faeroe",
      "Pacific/Ponape",
      "Pacific/Truk",
      "America/Buenos_Aires",
      "Pacific/Enderbury",
    ];
    const all = ZONE_GROUPS.flatMap((g) => g.cities.map((c) => c.zone));
    for (const stale of STALE) expect(all).not.toContain(stale);
  });

  test("Киев есть и стоит ПЕРВЫМ в своей группе", () => {
    // Он попадает в подпись строки только из первых трёх; ради этого
    // порядок городов и задан по узнаваемости.
    const g = ZONE_GROUPS.find((x) => x.cities.some((c) => c.name === "Kyiv"));
    expect(g).toBeDefined();
    expect(g!.cities[0].name).toBe("Kyiv");
  });

  test("Иерусалим НЕ в одной группе с Хельсинки", () => {
    // Израиль переводит часы не в те же дни, что ЕС. Помесячная сверка
    // этого не видела и сваливала их вместе — та ошибка держалась один день.
    const jer = ZONE_GROUPS.find((x) =>
      x.cities.some((c) => c.name === "Jerusalem"),
    );
    expect(jer!.cities.some((c) => c.name === "Helsinki")).toBe(false);
  });

  test("ГЛАВНОЕ: две группы никогда не ведут себя одинаково круглый год", () => {
    // Иначе это дубль: человеку предложены две строки, между которыми нет
    // никакой разницы ни в один день года.
    const seen = new Map<string, string>();
    for (const g of ZONE_GROUPS) {
      const sig = signature(g.zone);
      expect(seen.has(sig)).toBe(false);
      seen.set(sig, g.zone);
    }
  });

  test("группы идут с запада на восток", () => {
    const jan = new Date(Date.UTC(2026, 0, 15, 12));
    const offs = ZONE_GROUPS.map((g) => offsetMinutes(g.zone, jan));
    expect([...offs].sort((a, b) => a - b)).toEqual(offs);
  });

  test("СЛУЖЕБНЫХ ЗОН НЕТ: ни Etc/GMT, ни UTC, ни однобуквенных", () => {
    // Они не места, а фиксированные смещения: часы не переводят вовсе.
    // У `Etc/GMT+N` вдобавок ИНВЕРТИРОВАН знак — строка «GMT+12» означает
    // UTC−12, то есть подпись противоречит значению рядом с ней. Bun отдаёт
    // их вместе с настоящими зонами (Node — нет), и один раз они уже
    // проехали в барабан: 27 августа их там было 27 штук.
    const zones = ZONE_GROUPS.flatMap((g) => g.cities.map((c) => c.zone));
    for (const z of zones) {
      expect(z.startsWith("Etc/")).toBe(false);
      expect(z).not.toBe("UTC");
      expect(z).not.toBe("GMT");
      // Настоящая зона всегда «Регион/Город»; служебные — без слэша.
      expect(z.includes("/")).toBe(true);
    }
  });

  test("ПОКРЫТИЕ: города, по которым работает бизнес, на месте", () => {
    // Не весь мир — те, чьё отсутствие заметит живой человек. Кипр и
    // Украина здесь потому, что мастера продукта живут именно там.
    const MUST = [
      "Nicosia", "Kyiv", "Moscow", "Minsk", "Warsaw", "Berlin", "London",
      "Paris", "Madrid", "Rome", "Athens", "Istanbul", "Tbilisi", "Yerevan",
      "Baku", "Almaty", "Tashkent", "Dubai", "Tel Aviv", "Jerusalem",
      "New York", "Los Angeles", "Toronto", "Sao Paulo", "Tokyo", "Shanghai",
      "Kolkata", "Bangkok", "Sydney", "Auckland", "Cairo", "Johannesburg",
    ].filter((c) => c !== "Tel Aviv"); // в IANA Израиль — Asia/Jerusalem
    const names = new Set(ZONE_GROUPS.flatMap((g) => g.cities.map((c) => c.name)));
    for (const city of MUST) expect(names.has(city)).toBe(true);
  });

  test("имя города уникально во ВСЁМ списке", () => {
    // Bun отдаёт зоны вместе с псевдонимами, и без этой проверки поиск по
    // «Kyiv» мог бы вернуть две строки, между которыми человеку не выбрать.
    const names = ZONE_GROUPS.flatMap((g) => g.cities.map((c) => c.name));
    expect(new Set(names).size).toBe(names.length);
  });

  test("плоский список зон совпадает с представителями групп", () => {
    expect(TIMEZONE_OPTIONS).toEqual(ZONE_GROUPS.map((g) => g.zone));
  });
});
