import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function sourceFiles(root: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...sourceFiles(path));
    else if (
      [".ts", ".tsx"].includes(extname(entry.name)) &&
      !entry.name.endsWith(".test.ts")
    ) {
      result.push(path);
    }
  }
  return result;
}

describe("mobile UI product policy", () => {
  test("is permanently light-only at both Expo and runtime boundaries", () => {
    const appConfig = JSON.parse(
      readFileSync(resolve(here, "../../app.json"), "utf8"),
    ) as { expo?: { userInterfaceStyle?: string } };
    const bootstrap = readFileSync(resolve(here, "../bootstrap.ts"), "utf8");
    const entries = sourceFiles(resolve(here, ".."))
      .concat(sourceFiles(resolve(here, "../../app")))
      .map((path) => ({ path, source: readFileSync(path, "utf8") }));
    const offenders = entries
      .filter(
        ({ source }) =>
          /\buseColorScheme\b|\bsetColorScheme\("dark"\)/.test(source) ||
          /className\s*=\s*(?:["'][^"']*\bdark:|\{`[^`]*\bdark:)/s.test(source),
      )
      .map(({ path }) => path);

    assert.equal(appConfig.expo?.userInterfaceStyle, "light");
    assert.match(bootstrap, /Appearance\.setColorScheme\("light"\)/);
    assert.deepEqual(offenders, []);
  });

  test("does not reintroduce a generic plus icon for creation", () => {
    const entries = sourceFiles(resolve(here, ".."))
      .concat(sourceFiles(resolve(here, "../../app")))
      .map((path) => ({ path, source: readFileSync(path, "utf8") }));
    const plusImport =
      /import\s*{[^}]*\b(?:Plus|PlusCircle|CirclePlus|SquarePlus)\b[^}]*}\s*from\s*["']lucide-react-native["']/s;
    const offenders = entries
      .filter(({ source }) => plusImport.test(source))
      .map(({ path }) => path);
    const addRow = readFileSync(
      resolve(here, "../components/ui/AddRow.tsx"),
      "utf8",
    );

    assert.deepEqual(offenders, []);
    assert.match(addRow, /ChevronRight/);
  });

  test("shows a native loading surface after the splash screen is hidden", () => {
    const dashboardGate = readFileSync(resolve(here, "DashboardGate.tsx"), "utf8");
    const authLayout = readFileSync(
      resolve(here, "../../app/(auth)/_layout.tsx"),
      "utf8",
    );

    assert.match(dashboardGate, /state="loading"[\s\S]*Открываем компанию/);
    assert.doesNotMatch(dashboardGate, /gate\.status === "loading"\) return null/);
    assert.match(authLayout, /pendingInvitation\.isPending \|\| gate\.status === "loading"/);
    assert.match(authLayout, /Открываем аккаунт/);
  });
});
