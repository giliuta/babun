import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

// СТОРОЖ: ЧТЕНИЯ SQLite-ОБЁРТОК ИДУТ КЛИЕНТОМ, ПРИВЯЗАННЫМ К КОМПАНИИ КЛЮЧА.
//
// Гонка потери данных такая. Обёртка отдаёт снимок SQLite сразу и отпускает
// фоновое перечитывание, а оно шлёт страницы одну за другой — по 2–6 с каждую
// в очереди бесплатного плана. Глобальный клиент берёт заголовок компании в
// момент отправки: человек перешёл между страницами — следующая ушла под
// другой компанией, сервер ответил нулём строк, и `cacheReplaceTenant` стёр
// остаток записей (клиентов, тегов) той компании с меткой «сервер сказал:
// пусто». Сверка компании в очереди дообновления этого не закрывает — она
// смотрит только на старт.
//
// Хуки тянут react-native и под раннером не поднимаются, поэтому проверяется
// форма вызовов по исходнику, без комментариев.

const here = __dirname;

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** Код без комментариев и с одним пробелом вместо любых отступов. */
const flat = (rel: string): string =>
  stripComments(readFileSync(join(here, rel), "utf8")).replace(/\s+/g, " ");

describe("SQLite-обёртки читают под компанией ключа", () => {
  test("записи: все страницы и отпущенное перечитывание — привязанным клиентом", () => {
    const calendar = flat("../features/calendar/queries.ts");
    assert.match(
      calendar,
      /listAppointmentsCached\(pagingClient\(tenantBoundClient\(tenantId\)\), tenantId\)/,
    );
    assert.doesNotMatch(
      calendar,
      /listAppointmentsCached\(pagingClient\(\)/,
      "шим поверх глобального клиента берёт заголовок на каждую страницу",
    );
  });

  test("клиенты и теги: каждый вызов обёртки — привязанным клиентом", () => {
    const clients = flat("../features/clients/queries.ts");
    const calls = [
      ...clients.matchAll(/\b(listClientsCached|listClientTagsCached)\( ?([^,]+),/g),
    ];
    // useClients, запасной путь useClient, useClientTags.
    assert.ok(calls.length >= 3, `вызовов обёрток ${calls.length}`);
    for (const call of calls) {
      assert.equal(
        (call[2] as string).trim(),
        "tenantBoundClient(tenantId as string)",
        `${call[1]} читает не привязанным клиентом`,
      );
    }
  });

  test("архив и корзина — тоже", () => {
    const clients = flat("../features/clients/queries.ts");
    assert.match(
      clients,
      /queryFn: \(\) => read\(tenantBoundClient\(tenantId as string\), tenantId as string\)/,
    );
  });

  test("автометка клиента читает список привязанным клиентом", () => {
    const autoAssign = flat("../features/clients/label-auto-assign.ts");
    assert.match(autoAssign, /listClientsCached\(tenantBoundClient\(tenantId\), tenantId\)/);
  });

  test("мастерские RPC SQLite не пишут и остаются на обычном клиенте", () => {
    const clients = flat("../features/clients/queries.ts");
    assert.match(clients, /listMasterClientsSafe\(supabase\)/);
  });
});
