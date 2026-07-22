import { describe, expect, test } from "bun:test";
import { listClients, listClientTags } from "./clients";

const TENANT = "11111111-1111-1111-1111-111111111111";

function pagedSupabase(tables: Record<string, Array<Record<string, unknown>>>) {
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
    language: null,
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
