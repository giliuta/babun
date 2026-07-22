import { describe, expect, test } from "bun:test";
import type { Client } from "../../local/clients";
import { createClient, updateClient } from "./clients";

const TENANT = "11111111-1111-1111-1111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const TAG_ID = "33333333-3333-4333-8333-333333333333";

const input: Client = {
  id: CLIENT_ID,
  full_name: "Анна Клиент",
  phone: "+35799000000",
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
  language: "",
  birthday: "",
  blacklisted: false,
  pinned_at: null,
  reminder_at: null,
  phones: [],
  locations: [],
  notes: [],
  equipment: [],
  tag_ids: [TAG_ID, TAG_ID],
  phone_e164: "+35799000000",
  avatar_url: null,
  deleted_at: null,
  favorite_master_id: null,
  created_at: "2026-07-20T12:00:00.000Z",
};

const serverRow = {
  ...input,
  tenant_id: TENANT,
  language: null,
  tag_ids: [TAG_ID],
  updated_at: "2026-07-20T12:01:00.000Z",
};

type RpcCall = {
  args: Record<string, unknown>;
  name: string;
};

function rpcOnlySupabase(
  response: { data: unknown; error: unknown },
  calls: RpcCall[],
  onFallback?: () => never,
) {
  return {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return Promise.resolve(response);
    },
    from() {
      if (onFallback) return onFallback();
      throw new Error("legacy fallback must not run");
    },
  };
}

describe("atomic client + tag repository writes", () => {
  test("creates through one RPC with deduplicated tags and no mass-assignment fields", async () => {
    const calls: RpcCall[] = [];
    const result = await createClient(
      rpcOnlySupabase({ data: serverRow, error: null }, calls) as never,
      input,
      TENANT,
    );

    expect(result.tag_ids).toEqual([TAG_ID]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("create_client_with_tags");
    expect(calls[0]?.args.p_tenant_id).toBe(TENANT);
    expect(calls[0]?.args.p_client_id).toBe(CLIENT_ID);
    expect(calls[0]?.args.p_tag_ids).toEqual([TAG_ID]);
    expect(calls[0]?.args.p_client).not.toHaveProperty("id");
    expect(calls[0]?.args.p_client).not.toHaveProperty("tenant_id");
    expect(calls[0]?.args.p_client).not.toHaveProperty("updated_at");
  });

  test("does not downgrade a semantic RPC rejection to legacy writes", async () => {
    const calls: RpcCall[] = [];
    const supabase = rpcOnlySupabase(
      {
        data: null,
        error: {
          code: "23503",
          message: "client tag does not belong to the active tenant",
        },
      },
      calls,
    );

    await expect(createClient(supabase as never, input, TENANT)).rejects.toThrow(
      "client tag does not belong",
    );
    expect(calls).toHaveLength(1);
  });

  test("fails before legacy writes when tagged create needs a missing atomic RPC", async () => {
    const calls: RpcCall[] = [];
    let fallbackCalls = 0;
    const supabase = rpcOnlySupabase(
      {
        data: null,
        error: {
          code: "PGRST202",
          message:
            "Could not find the function public.create_client_with_tags in the schema cache",
        },
      },
      calls,
      () => {
        fallbackCalls += 1;
        throw new Error("legacy fallback reached");
      },
    );

    await expect(createClient(supabase as never, input, TENANT)).rejects.toThrow(
      "нельзя безопасно создать клиента с тегами",
    );
    expect(fallbackCalls).toBe(0);
  });

  test("keeps the one-table legacy create for an untagged client", async () => {
    const calls: RpcCall[] = [];
    let fallbackCalls = 0;
    const supabase = rpcOnlySupabase(
      {
        data: null,
        error: {
          code: "PGRST202",
          message:
            "Could not find the function public.create_client_with_tags in the schema cache",
        },
      },
      calls,
      () => {
        fallbackCalls += 1;
        throw new Error("legacy fallback reached");
      },
    );

    await expect(
      createClient(supabase as never, { ...input, tag_ids: [] }, TENANT),
    ).rejects.toThrow("legacy fallback reached");
    expect(fallbackCalls).toBe(1);
  });

  test("does not fallback for a schema-cache error naming another RPC", async () => {
    const calls: RpcCall[] = [];
    const supabase = rpcOnlySupabase(
      {
        data: null,
        error: {
          code: "PGRST202",
          message:
            "Could not find the function public.some_other_function in the schema cache",
        },
      },
      calls,
    );

    await expect(createClient(supabase as never, input, TENANT)).rejects.toThrow(
      "some_other_function",
    );
  });

  test("updates fields and supplied tags in one RPC", async () => {
    const calls: RpcCall[] = [];
    const result = await updateClient(
      rpcOnlySupabase(
        {
          data: { ...serverRow, city: "Лимасол", tag_ids: [] },
          error: null,
        },
        calls,
      ) as never,
      CLIENT_ID,
      { city: "Лимасол", tag_ids: [] },
      TENANT,
    );

    expect(result.city).toBe("Лимасол");
    expect(result.tag_ids).toEqual([]);
    expect(calls[0]?.name).toBe("update_client_with_tags");
    expect(calls[0]?.args.p_patch).toEqual({ city: "Лимасол" });
    expect(calls[0]?.args.p_tag_ids).toEqual([]);
  });

  test("omits p_tag_ids when an update must preserve assignments", async () => {
    const calls: RpcCall[] = [];
    await updateClient(
      rpcOnlySupabase(
        { data: { ...serverRow, city: "Пафос" }, error: null },
        calls,
      ) as never,
      CLIENT_ID,
      { city: "Пафос" },
      TENANT,
    );

    expect(calls[0]?.args).not.toHaveProperty("p_tag_ids");
  });

  test("fails before patching fields when tag update needs a missing atomic RPC", async () => {
    const calls: RpcCall[] = [];
    let fallbackCalls = 0;
    const supabase = rpcOnlySupabase(
      {
        data: null,
        error: {
          code: "PGRST202",
          message:
            "Could not find the function public.update_client_with_tags in the schema cache",
        },
      },
      calls,
      () => {
        fallbackCalls += 1;
        throw new Error("legacy fallback reached");
      },
    );

    await expect(
      updateClient(
        supabase as never,
        CLIENT_ID,
        { city: "Лимасол", tag_ids: [] },
        TENANT,
      ),
    ).rejects.toThrow("нельзя безопасно изменить теги клиента");
    expect(fallbackCalls).toBe(0);
  });
});
