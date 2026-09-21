import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, test } from "node:test";
import { READ_RPCS, WRITE_RPCS, isWriteRequest } from "./write-requests";

// СТОРОЖ РАЗБОРА «ЧТЕНИЕ ИЛИ ЗАПИСЬ».
//
// В режиме «его глазами» приложение не пишет вовсе, и решает это
// `isWriteRequest`. Цена ошибки несимметрична: чтение, принятое за запись, —
// это ошибка на экране предпросмотра; запись, принятая за чтение, — настоящие
// данные, созданные владельцем, который всего лишь смотрел. Поэтому
// неизвестное имя считается записью, а тест следит, чтобы каждая вызываемая
// приложением функция была названа явно.

const MOBILE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const REPO_ROOT = path.resolve(MOBILE_ROOT, "../..");
const SCANNED = [
  path.join(MOBILE_ROOT, "src"),
  path.join(MOBILE_ROOT, "app"),
  path.join(REPO_ROOT, "packages/shared/src"),
];

const BASE = "https://example.supabase.co";

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return /\.[jt]sx?$/.test(entry.name) && !/\.test\.[jt]sx?$/.test(entry.name)
      ? [absolute]
      : [];
  });
}

/** Каждое имя функции, которое приложение зовёт через `.rpc("…")`. */
function calledRpcs(): Map<string, string> {
  const found = new Map<string, string>();
  for (const root of SCANNED) {
    for (const file of sourceFiles(root)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/\.rpc\(\s*"([a-z0-9_]+)"/g)) {
        const name = match[1];
        if (name && !found.has(name)) found.set(name, path.relative(REPO_ROOT, file));
      }
    }
  }
  return found;
}

describe("разбор запросов на чтение и запись", () => {
  test("чтение строк записью не считается", () => {
    assert.equal(isWriteRequest("GET", `${BASE}/rest/v1/clients?select=*`), false);
    assert.equal(isWriteRequest("HEAD", `${BASE}/rest/v1/clients`), false);
  });

  test("правка строк — запись, каким бы методом ни шла", () => {
    assert.equal(isWriteRequest("POST", `${BASE}/rest/v1/clients`), true);
    assert.equal(isWriteRequest("PATCH", `${BASE}/rest/v1/clients?id=eq.1`), true);
    assert.equal(isWriteRequest("DELETE", `${BASE}/rest/v1/clients?id=eq.1`), true);
  });

  test("читающая функция проходит, пишущая — нет", () => {
    assert.equal(isWriteRequest("POST", `${BASE}/rest/v1/rpc/my_access_map`), false);
    assert.equal(
      isWriteRequest("POST", `${BASE}/rest/v1/rpc/list_members?select=id`),
      false,
    );
    assert.equal(isWriteRequest("POST", `${BASE}/rest/v1/rpc/issue_receipt`), true);
    assert.equal(isWriteRequest("POST", `${BASE}/rest/v1/rpc/set_member_access`), true);
  });

  test("незнакомая функция считается записью", () => {
    assert.equal(
      isWriteRequest("POST", `${BASE}/rest/v1/rpc/some_function_added_tomorrow`),
      true,
    );
  });

  test("сессия живёт: обновление токена не запись", () => {
    assert.equal(
      isWriteRequest("POST", `${BASE}/auth/v1/token?grant_type=refresh_token`),
      false,
    );
  });

  // Пока исключение было написано на весь `/auth/v1/`, в просмотре чужими
  // глазами работала смена пароля.
  test("смена пароля — запись", () => {
    assert.equal(isWriteRequest("PUT", `${BASE}/auth/v1/user`), true);
  });

  // Вход по паролю выдаёт НОВУЮ сессию, а не продлевает текущую: в режиме
  // просмотра он не нужен и раньше проходил вместе с обновлением токена.
  test("продлить сессию можно, выписать новую — нет", () => {
    assert.equal(
      isWriteRequest("POST", `${BASE}/auth/v1/token?grant_type=refresh_token`),
      false,
    );
    assert.equal(isWriteRequest("POST", `${BASE}/auth/v1/token?grant_type=password`), true);
    assert.equal(isWriteRequest("POST", `${BASE}/auth/v1/token`), true);
  });

  // Отбитый выход хуже открытого: сессия снимается локально ДО отказа, и
  // чистка данных компании с устройства не выполняется вовсе.
  test("выйти можно всегда", () => {
    assert.equal(isWriteRequest("POST", `${BASE}/auth/v1/logout`), false);
    assert.equal(isWriteRequest("POST", `${BASE}/auth/v1/logout?scope=others`), false);
  });

  // Раньше оба исключения искались подстрокой во ВСЁМ адресе.
  test("подстрока в чужом месте адреса двери не открывает", () => {
    assert.equal(
      isWriteRequest("POST", `${BASE}/rest/v1/clients?name=eq./auth/v1/token`),
      true,
    );
    assert.equal(
      isWriteRequest("POST", `${BASE}/storage/v1/object/sign-bucket/a.jpg`),
      true,
    );
  });

  test("ссылка на файл — чтение, ссылка на загрузку — запись", () => {
    assert.equal(
      isWriteRequest("POST", `${BASE}/storage/v1/object/sign/photos/a.jpg`),
      false,
    );
    assert.equal(
      isWriteRequest("POST", `${BASE}/storage/v1/object/upload/sign/photos/a.jpg`),
      true,
    );
  });

  test("загрузка файла — запись, чтение файла — нет", () => {
    assert.equal(isWriteRequest("POST", `${BASE}/storage/v1/object/photos/a.jpg`), true);
    assert.equal(isWriteRequest("GET", `${BASE}/storage/v1/object/photos/a.jpg`), false);
  });

  test("одна функция не может быть и чтением, и записью", () => {
    const both = [...READ_RPCS].filter((name) => WRITE_RPCS.has(name));
    assert.deepEqual(both, []);
  });

  // СТОРОЖ. Новая функция, забытая в обоих списках, будет молча отбиваться в
  // просмотре — экран покажет ошибку там, где должен был показать данные.
  // Тест падает на первой же такой и называет файл, где её зовут.
  test("каждая вызываемая функция названа в одном из списков", () => {
    const unknown = [...calledRpcs()]
      .filter(([name]) => !READ_RPCS.has(name) && !WRITE_RPCS.has(name))
      .map(([name, file]) => `${name} (${file})`);
    assert.deepEqual(
      unknown,
      [],
      "добавьте функцию в READ_RPCS или WRITE_RPCS в write-requests.ts — " +
        "решает объявленная волатильность в базе: stable = чтение, volatile = запись",
    );
  });

  test("скан дерева действительно находит вызовы", () => {
    // Иначе предыдущая проверка зеленела бы на пустом списке.
    assert.ok(calledRpcs().size >= 20);
  });
});
