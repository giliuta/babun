import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The lint resolver picks the `.web` file for both paths; bun reads them apart.
// eslint-disable-next-line import/no-duplicates
import * as phone from "./dict-source";
// eslint-disable-next-line import/no-duplicates
import * as site from "./dict-source.web";
import { UI_LOCALES } from "./locales";

const read = (path: string) => readFileSync(resolve(import.meta.dir, path), "utf8");
const translated = UI_LOCALES.map((l) => l.code).filter((code) => code !== "ru");

describe("where dictionaries come from", () => {
  it("every language has its case on the phone and on the site", () => {
    const phoneSource = read("dict-source.ts");
    const siteSource = read("dict-source.web.ts");
    for (const code of translated) {
      expect(phoneSource).toContain(`require("./dict/${code}.json")`);
      // `import()` — so Metro puts each language into its own web chunk.
      expect(siteSource).toContain(`import("./dict/${code}.json")`);
    }
    expect(siteSource).not.toContain("require(");
  });

  it("the phone has every dictionary at once, Russian has none", () => {
    expect(phone.loadDictionary("en")?.["Клиент"]).toBeTruthy();
    expect(phone.loadDictionary("ru")).toBeNull();
  });

  it("the site knows only the preloaded language", async () => {
    expect(site.loadDictionary("de")).toBeNull();
    await site.preloadDictionary("de");
    expect(site.loadDictionary("de")?.["Клиент"]).toBeTruthy();
    expect(site.loadDictionary("en")).toBeNull();
    await site.preloadDictionary("ru");
    expect(site.loadDictionary("ru")).toBeNull();
  });

  it("the site starts the app only after the dictionary arrived", () => {
    const entry = read("../../../../apps/mobile/index.web.js");
    expect(entry).toMatch(/preloadDictionary\(uiLocale\(\)\)\.then\(\(\) => \{[\s\S]*require\("expo-router\/entry"\)/);
    // Nothing of the app is imported statically ahead of the dictionary —
    // only the runtime with the chunk loader (without it `import()` fails)
    // and the language.
    const imports = [...entry.matchAll(/^import (?:.* from )?"([^"]+)";$/gm)].map((m) => m[1]);
    expect(imports).toEqual(["@expo/metro-runtime", "expo", "@babun/shared/i18n/locale", "@babun/shared/i18n/runtime"]);
    expect(read("runtime.ts")).toContain('from "./dict-source"');
    const pkg = JSON.parse(read("../../../../apps/mobile/package.json")) as { main: string };
    expect(pkg.main).toBe("index");
    expect(read("../../../../apps/mobile/index.js")).toContain('import "expo-router/entry";');
  });
});
