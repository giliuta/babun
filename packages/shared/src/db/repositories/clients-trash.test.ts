// АРХИВ И КОРЗИНА КЛИЕНТА — ОДНА КОЛОНКА РАЗНИЦЫ, и до сих пор ни одна из
// этих записей не была покрыта тестом. `deleted_at` без `purge_at` — архив
// (бессрочно), с `purge_at` — корзина (pg_cron сотрёт навсегда). Забытый
// четвёртый аргумент тихо превращает «удалить» в «спрятать», лишний —
// «спрятать» в «стереть через 30 дней», и ни то, ни другое не видно на экране.
//
// Массовой пары здесь нет, потому что её нет и в продукте: список клиентов
// архивирует ПОШТУЧНО через офлайн-обёртку (`useArchiveClients`, чанки по 8),
// чтобы каждая строка попала в очередь синхронизации и частичный провал был
// виден. Одним `.in(...)` этого не сделать.
import { describe, expect, it } from "bun:test";
import {
  TRASH_DAYS,
  deleteClient,
  purgeDateFromNow,
  restoreClient,
  softDeleteClient,
} from "./clients";

const TENANT = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";

interface Recorded {
  update: Record<string, unknown> | null;
  deleted: boolean;
  filters: Array<[string, unknown]>;
}

function clientsSupabase(row: { id: string } | null) {
  const log: Recorded = { update: null, deleted: false, filters: [] };
  const builder = {
    update(payload: Record<string, unknown>) {
      log.update = payload;
      return builder;
    },
    delete() {
      log.deleted = true;
      return builder;
    },
    eq(column: string, value: unknown) {
      log.filters.push([column, value]);
      return builder;
    },
    select: () => builder,
    single: () =>
      Promise.resolve(
        row
          ? { data: row, error: null }
          : { data: null, error: { message: "нет строки" } },
      ),
  };
  return { supabase: { from: () => builder } as never, log };
}

describe("срок жизни клиента в корзине", () => {
  it("держит 30 дней — столько же, сколько «Недавно удалённые» в Фото", () => {
    expect(TRASH_DAYS).toBe(30);
  });

  it("отмеряет КАЛЕНДАРНЫЕ дни, а не 30×24 часа", () => {
    // Сравнение по местной календарной дате, а не по миллисекундам: в дни
    // перевода часов 30 суток и 30 дней расходятся на час, и тест на разницу
    // времён падал бы дважды в году без единой ошибки в продукте.
    const expected = new Date();
    expected.setDate(expected.getDate() + TRASH_DAYS);
    const actual = new Date(purgeDateFromNow());

    expect(Number.isNaN(actual.getTime())).toBe(false);
    expect(actual.getFullYear()).toBe(expected.getFullYear());
    expect(actual.getMonth()).toBe(expected.getMonth());
    expect(actual.getDate()).toBe(expected.getDate());
  });
});

describe("архив против корзины", () => {
  it("без даты стирания клиент уходит В АРХИВ", async () => {
    const { supabase, log } = clientsSupabase({ id: CLIENT_ID });
    await softDeleteClient(supabase, CLIENT_ID, TENANT);

    expect(log.update?.purge_at).toBeNull();
    expect(typeof log.update?.deleted_at).toBe("string");
    expect(log.filters).toEqual([["id", CLIENT_ID], ["tenant_id", TENANT]]);
  });

  it("с датой стирания клиент уходит В КОРЗИНУ", async () => {
    const purgeAt = purgeDateFromNow();
    const { supabase, log } = clientsSupabase({ id: CLIENT_ID });
    await softDeleteClient(supabase, CLIENT_ID, TENANT, purgeAt);

    expect(log.update?.purge_at).toBe(purgeAt);
  });

  it("возврат снимает и невидимость, и срок стирания", async () => {
    const { supabase, log } = clientsSupabase({ id: CLIENT_ID });
    await restoreClient(supabase, CLIENT_ID, TENANT);

    expect(log.update).toEqual({ deleted_at: null, purge_at: null });
  });

  it("не молчит, когда прятать оказалось нечего", async () => {
    const { supabase } = clientsSupabase(null);

    await expect(
      softDeleteClient(supabase, CLIENT_ID, TENANT),
    ).rejects.toThrow("softDeleteClient: нет строки");
  });
});

describe("безвозвратное удаление клиента", () => {
  it("стирает строку только внутри своего тенанта", async () => {
    const { supabase, log } = clientsSupabase({ id: CLIENT_ID });
    await deleteClient(supabase, CLIENT_ID, TENANT);

    expect(log.deleted).toBe(true);
    expect(log.filters).toEqual([["id", CLIENT_ID], ["tenant_id", TENANT]]);
  });

  it("не молчит, когда строки не оказалось", async () => {
    const { supabase } = clientsSupabase(null);

    await expect(deleteClient(supabase, CLIENT_ID, TENANT)).rejects.toThrow(
      "deleteClient: нет строки",
    );
  });
});
