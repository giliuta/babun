import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// ГОТОВЫХ ТЕГОВ НЕТ (владелец 30.09 и 1.10: «не надо делать стандартные теги
// типа „Постоянные“ — пользователь системы сам разрабатывает свои теги»).
// Регистрация перестала их заводить в 20260930220000_client_settings_per_team
// (кусок `handle_new_user` вырезан в базе). Сторож — чтобы ни одна поздняя
// миграция и ни один экран не вернули их незаметно.

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(here, "../../../../../supabase/migrations");
const CUT = "20260930220000";

describe("готовых тегов клиентов нет", () => {
  test("ни одна миграция после очистки не заводит теги сама", () => {
    const late = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && f.slice(0, 14) > CUT);
    const offenders = late.filter((f) =>
      /insert\s+into\s+(public\.)?client_tags\b/i.test(readFileSync(join(MIGRATIONS, f), "utf8")),
    );
    assert.deepEqual(offenders, []);
  });

  test("тег создаёт только человек — экраном «Теги клиентов»", () => {
    const app = resolve(here, "../../../app");
    const tags = readFileSync(join(app, "(dashboard)/clients/tags.tsx"), "utf8");
    assert.match(tags, /useCreateClientTag\(\)/);
    const queries = readFileSync(join(here, "queries.ts"), "utf8");
    assert.doesNotMatch(queries, /["']Постоянн|["']VIP["']/);
  });
});
