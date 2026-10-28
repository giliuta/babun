import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CLIENT_PAGE, readClientWindow, type ListRpc } from "./client-window";

// СПИСОК ПАРТНЁРА И МАСТЕРА НЕ КОНЧАЕТСЯ НА ТЫСЯЧНОМ КЛИЕНТЕ (Н4).

/** Окно сервера в памяти: страницы по `p_offset`/`p_limit`; `legacy` — сервер
 *  до 20261028200000, у которого этих параметров нет. */
function windowServer(total: number, opts: { legacy?: boolean } = {}) {
  const calls: (Record<string, unknown> | undefined)[] = [];
  const rows = Array.from({ length: total }, (_, i) => ({ id: `c${i}` }));
  const rpc: ListRpc = (_name, args) => {
    calls.push(args);
    if (args && "p_client_id" in args) {
      return Promise.resolve({ data: rows.filter((r) => r.id === args.p_client_id), error: null });
    }
    if (args && "p_offset" in args) {
      if (opts.legacy) return Promise.resolve({ data: null, error: { message: "no function", code: "PGRST202" } });
      const from = args.p_offset as number;
      return Promise.resolve({ data: rows.slice(from, from + (args.p_limit as number)), error: null });
    }
    // Без параметров сервер, как PostgREST, отдаёт не больше тысячи.
    return Promise.resolve({ data: rows.slice(0, CLIENT_PAGE), error: null });
  };
  return { rpc, calls };
}

describe("окно клиентов страницами", () => {
  test("2 200 клиентов — все, тремя страницами", async () => {
    const server = windowServer(2200);
    const rows = await readClientWindow(server.rpc, "list_member_clients");
    assert.equal(rows.length, 2200);
    assert.deepEqual(server.calls.map((c) => c?.p_offset), [0, 1000, 2000]);
  });

  test("ровно тысяча — вторая страница пустая и завершает чтение", async () => {
    const server = windowServer(1000);
    assert.equal((await readClientWindow(server.rpc, "list_master_clients_safe")).length, 1000);
    assert.equal(server.calls.length, 2);
  });

  test("сервер до наката — одним вызовом, как раньше", async () => {
    const server = windowServer(300, { legacy: true });
    assert.equal((await readClientWindow(server.rpc, "list_member_clients")).length, 300);
    assert.deepEqual(server.calls, [{ p_offset: 0, p_limit: CLIENT_PAGE }, undefined]);
  });

  test("карточка одного клиента — один вызов без страниц", async () => {
    const server = windowServer(5);
    assert.deepEqual(await readClientWindow(server.rpc, "list_member_clients", "c3"), [{ id: "c3" }]);
    assert.deepEqual(server.calls, [{ p_client_id: "c3" }]);
  });

  test("другая ошибка сервера — исключение, а не пустой список", async () => {
    const rpc: ListRpc = () => Promise.resolve({ data: null, error: { message: "denied", code: "42501" } });
    await assert.rejects(() => readClientWindow(rpc, "list_member_clients"), /denied/);
  });
});
