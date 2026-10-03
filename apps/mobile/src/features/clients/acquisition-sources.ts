import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { tenantBoundClient } from "@/lib/tenant-bound-client";
import { useClientsSourceScope } from "@/features/clients/queries";
import type { ClientSource } from "@/features/clients/acquisition-source";

// СВОИ ИСТОЧНИКИ КОМАНДЫ — данные (владелец 03.10). Правила показа и выбора —
// в `acquisition-source.ts`, здесь только чтение и правка `client_sources`.
//
// Читаем все источники компании разом: их единицы, а карточке, списку и
// фильтру нужны источники разных команд. Кто правит — решает сервер
// (владелец или право «Справочники» в этой команде); экран лишь не даёт
// нажать там, где правка всё равно будет отказана.

export const clientSourcesKey = (tenantId: string | null) =>
  ["client-sources", tenantId] as const;

const COLUMNS = "id, tenant_id, team_id, name, position";

function useSourcesScope() {
  const scope = useClientsSourceScope();
  const tenantId = scope?.tenantId ?? null;
  const client = !tenantId || scope?.isActive ? supabase : tenantBoundClient(tenantId);
  return { scope, tenantId, client };
}

export function useClientSources() {
  const { scope, tenantId, client } = useSourcesScope();
  return useQuery({
    queryKey: clientSourcesKey(tenantId),
    enabled: !!tenantId,
    queryFn: async (): Promise<ClientSource[]> => {
      // Клиент записи справочником компании не распоряжается.
      if (scope?.kind === "record") return [];
      const { data, error } = await client
        .from("client_sources")
        .select(COLUMNS)
        .eq("tenant_id", tenantId as string)
        .order("position")
        .order("name");
      if (error) throw new Error(`client_sources: ${error.message}`);
      return (data ?? []) as ClientSource[];
    },
  });
}

// Политика, которая прячет строку, отказывает молча: ноль строк без ошибки.
const NO_RIGHT = "Нет права менять источники этой команды.";

function friendly(message: string): string {
  if (/client_sources_team_name|duplicate key/i.test(message)) {
    return "Такой источник у команды уже есть.";
  }
  if (/row-level security|permission denied/i.test(message)) {
    return NO_RIGHT;
  }
  return message;
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ["client-sources"] });
}

export function useCreateClientSource() {
  const { tenantId, client } = useSourcesScope();
  const invalidate = useInvalidate();
  return useMutation<ClientSource, Error, { name: string; teamId: string; position: number }>({
    mutationFn: async ({ name, teamId, position }) => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Введите название источника.");
      if (!tenantId) throw new Error("Нет активного тенанта");
      const { data, error } = await client
        .from("client_sources")
        .insert({ tenant_id: tenantId, team_id: teamId, name: trimmed, position })
        .select(COLUMNS)
        .single();
      if (error) throw new Error(friendly(error.message));
      return data as ClientSource;
    },
    onSettled: invalidate,
    meta: { errorHandled: true },
  });
}

export function useRenameClientSource() {
  const { client } = useSourcesScope();
  const invalidate = useInvalidate();
  return useMutation<void, Error, { id: string; name: string }>({
    mutationFn: async ({ id, name }) => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Введите название источника.");
      const { data, error } = await client
        .from("client_sources")
        .update({ name: trimmed })
        .eq("id", id)
        .select("id");
      if (error) throw new Error(friendly(error.message));
      if (!data?.length) throw new Error(NO_RIGHT);
    },
    onSettled: invalidate,
    meta: { errorHandled: true },
  });
}

/** Порядок — построчно, как у тегов: источников единицы. */
export function useReorderClientSources() {
  const { client } = useSourcesScope();
  const invalidate = useInvalidate();
  return useMutation<void, Error, string[]>({
    mutationFn: async (orderedIds) => {
      for (const [position, id] of orderedIds.entries()) {
        const { error } = await client.from("client_sources").update({ position }).eq("id", id);
        if (error) throw new Error(friendly(error.message));
      }
    },
    onSettled: invalidate,
    meta: { errorHandled: true },
  });
}

/** Удалённый источник у клиентов читается как «Другое» — их карточки не
 *  переписываем. */
export function useDeleteClientSource() {
  const { client } = useSourcesScope();
  const invalidate = useInvalidate();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const { data, error } = await client.from("client_sources").delete().eq("id", id).select("id");
      if (error) throw new Error(friendly(error.message));
      if (!data?.length) throw new Error(NO_RIGHT);
    },
    onSettled: invalidate,
    meta: { errorHandled: true },
  });
}
