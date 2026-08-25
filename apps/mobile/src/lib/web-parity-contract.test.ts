import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// ПРИЛОЖЕНИЕ ОДНО НА ТЕЛЕФОН И БРАУЗЕР — СТОРОЖ У ДВУХ ДЫРЯВЫХ API.
//
// react-native-web не эмулирует ни `Alert.alert` (там буквально
// `static alert() {}`), ни `@react-native-community/datetimepicker` (общий
// фолбэк пакета рисует `null`). Прямой вызов того и другого компилируется,
// проходит ревью и молча ломает ровно то, ради чего браузер открывают:
// подтверждения и ошибки не показываются, дату и время ввести нечем.
//
// Оба заменены примитивами (lib/notify, lib/confirm, lib/choose,
// components/ui/DateTimeInput). Этот тест держит замену на месте: он смотрит
// КОД (комментарии вырезаны — правило объясняется словами и не должно ронять
// собственный тест) и разрешает прямое обращение только там, где живёт сама
// платформенная развилка.

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "../..");

/** Единственные места, где системный алерт — это реализация, а не вызов. */
const ALERT_ALLOWED = new Set([
  "src/lib/notify.ts", // нативная половина notify()
  "src/lib/choose.ts", // запасной лист выбора, когда хост не смонтирован
]);

/** Единственное место, где пакет пикера подключается напрямую. */
const PICKER_ALLOWED = new Set([
  "src/components/ui/DateTimeInput.tsx", // нативная половина DateTimeInput
]);

/** Модули, которых в браузере либо нет вовсе, либо они делают другое. Файл
 *  из src/lib, который их трогает, обязан ПОКАЗАТЬ, что про браузер подумали:
 *  ветка по платформе, ветка по DOM — или строка в исключениях ниже. */
const NATIVE_ONLY_MODULES = [
  "expo-secure-store",
  "expo-file-system",
  "expo-sharing",
  "expo-notifications",
  "expo-haptics",
  "@react-native-community/netinfo",
];

/** Признаки того, что про браузер подумали. */
const WEB_AWARE =
  /Platform\.OS\s*[!=]==\s*["']web["']|typeof document\s*!==|typeof localStorage\s*!==/;

/** Файлы, где веб-ветки нет ОСОЗНАННО. Каждая строка — почему тишина в
 *  браузере не обман, а верный ответ. */
const NATIVE_ONLY_EXEMPT = new Set([
  // У expo-haptics СВОЙ веб-двойник (navigator.vibrate), а на настольном
  // браузере вибромотора нет — молчание и есть правильный отклик.
  "src/lib/haptics.ts",
  // Модуль подключён guarded-require, а недоступность не проглатывается:
  // reconcile возвращает статус "unavailable", и его показывают человеку
  // (features/appointments/useBookingSave.ts, AppointmentSheet.tsx).
  "src/lib/notifications.ts",
]);

function sourceFiles(root: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      result.push(...sourceFiles(path));
    } else if (
      [".ts", ".tsx"].includes(extname(entry.name)) &&
      // Сами тесты — не продукт: этот файл цитирует запрещённые имена.
      !/\.test\.tsx?$/.test(entry.name)
    ) {
      result.push(path);
    }
  }
  return result;
}

/** Строки-комментарии прочь: правило объясняется по-русски прямо в коде. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

const entries = [
  ...sourceFiles(join(appRoot, "app")),
  ...sourceFiles(join(appRoot, "src")),
].map((path) => ({
  id: relative(appRoot, path),
  code: codeOnly(readFileSync(path, "utf8")),
}));

describe("веб-паритет: платформенные API только за примитивами", () => {
  test("дерево видит app/ и src/ целиком", () => {
    // Дешёвая страховка от «тест зелёный, потому что ничего не прочитал».
    assert.ok(entries.length > 200, `прочитано файлов: ${entries.length}`);
  });

  test("Alert.alert не зовут напрямую — только notify / confirmAction / chooseOption", () => {
    const offenders = entries
      .filter(({ id, code }) => !ALERT_ALLOWED.has(id) && /\bAlert\s*\.\s*alert\s*\(/.test(code))
      .map(({ id }) => id);
    assert.deepEqual(
      offenders,
      [],
      "в браузере Alert.alert — пустая функция: сообщение не покажется, " +
        `а onPress разрушительной кнопки не вызовется никогда. Файлы: ${offenders.join(", ")}`,
    );
  });

  test("@react-native-community/datetimepicker импортируют только в DateTimeInput", () => {
    const offenders = entries
      .filter(
        ({ id, code }) =>
          !PICKER_ALLOWED.has(id) &&
          /from\s+["']@react-native-community\/datetimepicker["']/.test(code),
      )
      .map(({ id }) => id);
    assert.deepEqual(
      offenders,
      [],
      "на вебе пакет рисует null — дату и время ввести нечем; берите " +
        `DateTimeInput из components/ui. Файлы: ${offenders.join(", ")}`,
    );
  });

  test("оба примитива держат ОБЕ платформы", () => {
    const notifySrc = readFileSync(join(appRoot, "src/lib/notify.ts"), "utf8");
    const nativePicker = readFileSync(
      join(appRoot, "src/components/ui/DateTimeInput.tsx"),
      "utf8",
    );
    const webPicker = readFileSync(
      join(appRoot, "src/components/ui/DateTimeInput.web.tsx"),
      "utf8",
    );

    // notify обязан иметь веб-ветку: без неё «одна точка» снова молчит.
    assert.match(notifySrc, /Platform\.OS === "web"/);
    assert.match(nativePicker, /@react-native-community\/datetimepicker/);
    // Веб-двойник принимает пропы, которыми места вызова уже пользуются —
    // замена «по имени» не должна терять подпись для скринридера.
    for (const prop of ["accessibilityLabel", "minuteInterval", "minimumDate", "maximumDate"]) {
      assert.match(webPicker, new RegExp(`\\b${prop}\\??:`), prop);
    }
  });

  test("веб-двойник не обещает режимов, которых не рисует", () => {
    // Тип нативного пикера ШИРЕ веб-двойника: пакет знает ещё «datetime» и
    // «countdown». Значит `tsc` (он резолвит нативный файл) такой mode
    // пропустит, а в браузере `<input type="date">` тихо съест время. Держим
    // союз узким и сверяем с местами вызова здесь.
    const webPicker = codeOnly(
      readFileSync(join(appRoot, "src/components/ui/DateTimeInput.web.tsx"), "utf8"),
    );
    const declaration = webPicker.match(/\bmode\?:\s*([^;]+);/);
    assert.ok(declaration, "у веб-двойника должен быть проп mode");
    const modes = [...declaration[1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(
      modes,
      ["date", "time"],
      "разметка двойника различает ровно два режима (`<input type=\"date\">` и " +
        "`<input type=\"time\">`); шире союз — снова обещание без реализации",
    );

    const users = entries.filter(({ code }) =>
      /from\s+["'][^"']*\/DateTimeInput["']/.test(code),
    );
    assert.ok(users.length > 5, `мест вызова DateTimeInput: ${users.length}`);
    const offenders = users.flatMap(({ id, code }) =>
      [...code.matchAll(/\bmode=["']([a-z-]+)["']/g)]
        .filter((m) => !modes.includes(m[1]))
        .map((m) => `${id}: mode="${m[1]}"`),
    );
    assert.deepEqual(
      offenders,
      [],
      `в браузере такой режим нарисовать нечем. Места: ${offenders.join(", ")}`,
    );
  });

  test("нативный модуль в src/lib — только с оглядкой на браузер", () => {
    // Общая кухня продукта: сюда ходят все экраны, и функция, которая на вебе
    // тихо ничего не делает, отсюда расходится по всему приложению разом
    // (так уже было с выгрузкой CSV — expo-sharing в браузере отвечает «нет»,
    // и кнопка молчала). Проверяем только src/lib: это тот слой, который
    // прочитан целиком; фичи со своими guarded-require придут отдельно.
    const lib = entries.filter(({ id }) => id.startsWith("src/lib/"));
    assert.ok(lib.length > 20, `файлов в src/lib: ${lib.length}`);
    const offenders = lib
      .filter(({ id, code }) => {
        if (NATIVE_ONLY_EXEMPT.has(id)) return false;
        const touches = NATIVE_ONLY_MODULES.some((mod) =>
          code.includes(`"${mod}"`) || code.includes(`'${mod}'`),
        );
        return touches && !WEB_AWARE.test(code);
      })
      .map(({ id }) => id);
    assert.deepEqual(
      offenders,
      [],
      "нативный модуль без ветки на браузер: в вебе функция промолчит, а " +
        "вызывающий экран решит, что всё получилось. Заведите ветку, " +
        `двойник .web.ts — или строку в NATIVE_ONLY_EXEMPT с причиной. Файлы: ${offenders.join(", ")}`,
    );
  });
});
