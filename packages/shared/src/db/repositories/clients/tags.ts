// Client tag reference book: paged list and CRUD.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../database.types";
import type { ClientTag } from "../../../local/clients";
import { CLIENT_PAGE_SIZE } from "./reads";

type DbSupabase = SupabaseClient<Database>;
type TagRow = Database["public"]["Tables"]["client_tags"]["Row"];

async function listClientTagRows(
  supabase: DbSupabase,
  tenantId: string,
): Promise<TagRow[]> {
  const rows: TagRow[] = [];
  for (let offset = 0; ; offset += CLIENT_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("client_tags")
      .select("*")
      .eq("tenant_id", tenantId)
      // ПОРЯДОК СПРАВОЧНИКА — РУКА ВЛАДЕЛЬЦА, а имя лишь разводит равные:
      // до 2026-09-10 список шёл по алфавиту, потому что колонки порядка не
      // было вовсе.
      .order("position", { ascending: true })
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + CLIENT_PAGE_SIZE - 1);
    if (error) throw new Error(`listClientTags: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < CLIENT_PAGE_SIZE) break;
  }
  return rows;
}

function rowToTag(r: TagRow): ClientTag {
  return {
    id: r.id,
    name: r.name,
    color: r.color,
    icon: r.icon ?? null,
    position: r.position ?? 0,
    hidden: r.hidden ?? false,
    team_id: r.team_id ?? null,
  };
}

export async function listClientTags(
  supabase: DbSupabase,
  tenantId: string,
): Promise<ClientTag[]> {
  return (await listClientTagRows(supabase, tenantId)).map(rowToTag);
}

export async function createClientTag(
  supabase: DbSupabase,
  input: {
    id?: string;
    name: string;
    color: string;
    icon?: string | null;
    /** Команда тега — обязательна (у каждой команды свои теги, 30.09). */
    team_id: string;
  },
  tenantId: string,
): Promise<ClientTag> {
  const { data, error } = await supabase
    .from("client_tags")
    .insert({
      ...(input.id ? { id: input.id } : {}),
      tenant_id: tenantId,
      team_id: input.team_id,
      name: input.name,
      color: input.color,
      icon: input.icon ?? null,
    })
    .select("*")
    .single();
  if (error) throw new Error(`createClientTag: ${error.message}`);
  return rowToTag(data);
}

export async function updateClientTag(
  supabase: DbSupabase,
  id: string,
  patch: {
    name?: string;
    color?: string;
    icon?: string | null;
    position?: number;
    hidden?: boolean;
  },
  tenantId: string,
): Promise<ClientTag> {
  const { data, error } = await supabase
    .from("client_tags")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();
  if (error) throw new Error(`updateClientTag: ${error.message}`);
  return rowToTag(data);
}

export async function deleteClientTag(
  supabase: DbSupabase,
  id: string,
  tenantId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("client_tags")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("id")
    .single();
  if (error) throw new Error(`deleteClientTag: ${error.message}`);
  if (data.id !== id) throw new Error("deleteClientTag: тег не найден");
}
