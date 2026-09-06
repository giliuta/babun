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
  test("ожидание всегда ДВИЖЕТСЯ: системный ActivityIndicator в продукте не используется", () => {
    // Владелец 2026-07-27: «оно как будто зависло… давай сделаем анимацию,
    // чтоб крутилась, если оно думает». Системный индикатор серый (вне
    // палитры), а в программно показанном RefreshControl iOS рисует его
    // СТОЯЩИМ. Единственная крутилка продукта — components/ui/Spinner.
    const entries = sourceFiles(resolve(here, ".."))
      .concat(sourceFiles(resolve(here, "../../app")))
      .map((path) => ({ path, source: readFileSync(path, "utf8") }));
    const offenders = entries
      .filter(({ source }) => /<ActivityIndicator\b/.test(source))
      .map(({ path }) => path);
    assert.deepEqual(offenders, [], `используйте <Spinner />: ${offenders.join(", ")}`);
  });

  test("контрол обновления отражает ЖЕСТ, а не фоновое дообновление", () => {
    // refreshing={isRefetching} показывал контрол ПРОГРАММНО при каждом
    // возврате на экран: список уезжал вниз сам. Источник — usePullRefresh.
    const entries = sourceFiles(resolve(here, ".."))
      .concat(sourceFiles(resolve(here, "../../app")))
      .map((path) => ({ path, source: readFileSync(path, "utf8") }));
    const offenders = entries
      // Комментарии не код: правило объясняется словами в LoadingBar и в
      // usePullRefresh, и объяснение не должно ронять свой же тест.
      .map(({ path, source }) => ({
        path,
        code: source.replace(/^\s*(?:\/\/|\*|\/\*).*$/gm, ""),
      }))
      .filter(({ code }) =>
        /refreshing=\{[^}]*is(?:Refetching|Fetching)/.test(code),
      )
      .map(({ path }) => path);
    assert.deepEqual(offenders, [], `используйте usePullRefresh: ${offenders.join(", ")}`);
  });

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
    // Вызов опциональный (`?.`): в react-native-web Appearance доступен
    // только на чтение и метода не имеет — незащищённый вызов ронял весь
    // boot веб-сборки. Политика от этого не слабеет: на нативе схема
    // по-прежнему прибивается к light, а на вебе её держат
    // userInterfaceStyle из app.json и собственные токены (тёмной темы в
    // палитре просто нет).
    assert.match(bootstrap, /Appearance\.setColorScheme\??\.?\("light"\)/);
    assert.deepEqual(offenders, []);
  });

  test("does not reintroduce a generic plus icon for creation", () => {
    const entries = sourceFiles(resolve(here, ".."))
      .concat(sourceFiles(resolve(here, "../../app")))
      .map((path) => ({ path, source: readFileSync(path, "utf8") }));
    const plusImport =
      /import\s*{[^}]*\b(?:Plus|PlusCircle|CirclePlus|SquarePlus)\b[^}]*}\s*from\s*["']lucide-react-native["']/s;
    // ЕДИНСТВЕННОЕ ИСКЛЮЧЕНИЕ — шапка `SectionCard` (владелец 2026-09-06:
    // «маленькая шапка „Файлы“, справа плюсик»). Значок там выбирается
    // токеном `icon: "add"`, снаружи `Plus` не передать — второго плюса без
    // слова владельца не появится.
    const allowed = new Set([resolve(here, "../components/ui/SectionCard.tsx")]);
    const offenders = entries
      .filter(({ path, source }) => !allowed.has(path) && plusImport.test(source))
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
