import { describe, expect, test } from "bun:test";
import type { Location } from "../../local/clients";
import { getClient, listClients, listClientTags } from "./clients";

const TENANT = "11111111-1111-1111-1111-111111111111";

function pagedSupabase(tables: Record<string, Record<string, unknown>[]>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const builder = {
        select(_columns: string) {
          return builder;
        },
        eq(column: string, value: unknown) {
          rows = rows.filter((row) => row[column] === value);
          return builder;
        },
        is(column: string, value: unknown) {
          rows = rows.filter((row) => (row[column] ?? null) === value);
          return builder;
        },
        order(column: string, options?: { ascending?: boolean }) {
          const direction = options?.ascending === false ? -1 : 1;
          rows.sort((a, b) =>
            String(a[column] ?? "").localeCompare(String(b[column] ?? "")) * direction,
          );
          return builder;
        },
        range(from: number, to: number) {
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
        },
      };
      return builder;
    },
  };
}

function clientRow(index: number) {
  const suffix = String(index).padStart(8, "0");
  return {
    id: `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`,
    tenant_id: TENANT,
    full_name: `Клиент ${index}`,
    phone: "",
    whatsapp_phone: "",
    email: "",
    sms_name: "",
    telegram_username: "",
    instagram_username: "",
    balance: 0,
    discount: 0,
    comment: "",
    acquisition_source: "unknown",
    referred_by_client_id: null,
    first_contact_date: null,
    address: "",
    city: "",
    property_type: "",
    birthday: "",
    blacklisted: false,
    pinned_at: null,
    reminder_at: null,
    phones: [],
    locations: [],
    notes: [],
    equipment: [],
    phone_e164: null,
    avatar_url: null,
    deleted_at: null,
    favorite_master_id: null,
    created_at: "2026-07-20T00:00:00.000Z",
    updated_at: "2026-07-20T00:00:00.000Z",
  };
}

describe("client repository paging", () => {
  test("returns clients and assignments beyond the PostgREST 1000-row window", async () => {
    const clients = Array.from({ length: 1005 }, (_, index) => clientRow(index));
    const assignments = clients.map((client, index) => ({
      tenant_id: TENANT,
      client_id: client.id,
      tag_id: `tag-${String(index).padStart(4, "0")}`,
    }));
    const supabase = pagedSupabase({
      clients,
      client_tag_assignments: assignments,
    });

    const result = await listClients(supabase as never, TENANT);

    expect(result).toHaveLength(1005);
    expect(result[1004]?.full_name).toBe("Клиент 1004");
    expect(result[1004]?.tag_ids).toEqual(["tag-1004"]);
  });

  // Регресс. Маппер перечисляет поля объекта руками, а запись
  // (clientToUpdate) отдаёт locations в базу целиком. Пока маппер не читал
  // график ТО и тип объекта, первая же правка объекта стирала их и на
  // сервере, а serviceDueState всегда возвращал null — блок «Обслуживание»
  // молчал при заполненных датах. Поле, добавленное в Location/ACUnit, но
  // забытое здесь, воспроизводит ровно эту потерю.
  test("объект и кондиционер доезжают до домена целиком (график ТО не теряется)", async () => {
    const location: Location = {
      id: "loc-1",
      label: "Дом",
      address: "Агиос Тихонас 21",
      mapUrl: "https://maps.app.goo.gl/abc",
      property_type: "house",
      isPrimary: true,
      note: "Домофон 25",
      equipment: [
        {
          id: "ac-1",
          room: "Спальня",
          brand: "Daikin",
          model: "FTXS35",
          ac_type: "split",
          has_indoor: true,
          has_outdoor: true,
          installed_at: "2024-05-01",
          last_service_at: "2026-04-14",
          service_interval_months: 12,
        },
      ],
    };

    const [client] = await listClients(
      pagedSupabase({
        clients: [{ ...clientRow(1), locations: [location] }],
        client_tag_assignments: [],
      }) as never,
      TENANT,
    );

    expect(client?.locations[0]).toEqual(location);
  });

  test("returns reference tags beyond the first page", async () => {
    const tags = Array.from({ length: 1005 }, (_, index) => ({
      id: `tag-${String(index).padStart(4, "0")}`,
      tenant_id: TENANT,
      name: `Метка ${String(index).padStart(4, "0")}`,
      color: "#3366ff",
      created_at: "2026-07-20T00:00:00.000Z",
    }));
    const result = await listClientTags(
      pagedSupabase({ client_tags: tags }) as never,
      TENANT,
    );

    expect(result).toHaveLength(1005);
    expect(result.at(-1)?.id).toBe("tag-1004");
  });
});

/** Как PostgREST: первый `.order()` — главный ключ, следующие разводят
 *  равные. Числа сравниваются как числа. */
function orderedSupabase(tables: Record<string, Record<string, unknown>[]>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const keys: string[] = [];
      const sorted = () =>
        [...rows].sort((a, b) => {
          for (const key of keys) {
            const x = a[key];
            const y = b[key];
            const diff =
              typeof x === "number" && typeof y === "number"
                ? x - y
                : String(x ?? "").localeCompare(String(y ?? ""));
            if (diff !== 0) return diff;
          }
          return 0;
        });
      const builder = {
        select(_columns: string) {
          return builder;
        },
        eq(column: string, value: unknown) {
          rows = rows.filter((row) => row[column] === value);
          return builder;
        },
        is(column: string, value: unknown) {
          rows = rows.filter((row) => (row[column] ?? null) === value);
          return builder;
        },
        order(column: string) {
          keys.push(column);
          return builder;
        },
        range(from: number, to: number) {
          return Promise.resolve({ data: sorted().slice(from, to + 1), error: null });
        },
        maybeSingle() {
          return Promise.resolve({ data: sorted()[0] ?? null, error: null });
        },
        then<T>(resolve: (value: { data: Record<string, unknown>[]; error: null }) => T) {
          return Promise.resolve({ data: sorted(), error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
}

// Первый тег набора — главный: его имя на плитке клиента. Порядок держит
// место тега (`position`), а не id: иначе главным выходил тег с меньшим id, и
// плитка перескакивала после сохранения.
describe("client tags keep the set order", () => {
  const first = clientRow(1);
  const second = clientRow(2);
  const assignments = [
    { tenant_id: TENANT, client_id: first.id, tag_id: "tag-a", position: 1 },
    { tenant_id: TENANT, client_id: first.id, tag_id: "tag-b", position: 0 },
    { tenant_id: TENANT, client_id: first.id, tag_id: "tag-c", position: 10 },
    { tenant_id: TENANT, client_id: first.id, tag_id: "tag-d", position: 2 },
    // Строки, записанные мимо функций, лежат с местом 0 — их разводит id.
    { tenant_id: TENANT, client_id: second.id, tag_id: "tag-z", position: 0 },
    { tenant_id: TENANT, client_id: second.id, tag_id: "tag-y", position: 0 },
  ];
  const tables = { clients: [first, second], client_tag_assignments: assignments };

  test("listClients returns tag_ids by place, ties by id", async () => {
    const result = await listClients(orderedSupabase(tables) as never, TENANT);
    expect(result.find((c) => c.id === first.id)?.tag_ids).toEqual(["tag-b", "tag-a", "tag-d", "tag-c"]);
    expect(result.find((c) => c.id === second.id)?.tag_ids).toEqual(["tag-y", "tag-z"]);
  });

  test("getClient returns the same order", async () => {
    const client = await getClient(orderedSupabase(tables) as never, first.id, TENANT);
    expect(client?.tag_ids).toEqual(["tag-b", "tag-a", "tag-d", "tag-c"]);
  });
});
