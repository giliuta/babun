import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { clientsSearchPlaceholder } from "./search-placeholder";

const here = dirname(fileURLToPath(import.meta.url));

describe("число клиентов в поле поиска", () => {
  test("родительный: среди 1 / 21 клиента, среди 2 / 5 / 248 клиентов", () => {
    assert.equal(clientsSearchPlaceholder(1), "Поиск среди 1 клиента");
    assert.equal(clientsSearchPlaceholder(21), "Поиск среди 21 клиента");
    assert.equal(clientsSearchPlaceholder(2), "Поиск среди 2 клиентов");
    assert.equal(clientsSearchPlaceholder(5), "Поиск среди 5 клиентов");
    assert.equal(clientsSearchPlaceholder(248), "Поиск среди 248 клиентов");
  });
  test("пока список едет и при нуле — без числа", () => {
    assert.equal(clientsSearchPlaceholder(null), "Поиск");
    assert.equal(clientsSearchPlaceholder(0), "Поиск");
  });
  test("число — видимый список: команда и фильтры, не весь справочник", () => {
    const bar = readFileSync(resolve(here, "ListTopBar.tsx"), "utf8");
    assert.match(
      bar,
      /placeholder=\{clientsSearchPlaceholder\(\s*isLoading \|\| data === undefined \? null : result\.filtered\.length,\s*\)\}/,
    );
  });
});
