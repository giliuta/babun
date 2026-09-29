import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Json } from "@babun/shared/db/database.types";

import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

import type { AccessLevel } from "../access-map";
import { parseTemplates, type AccessTemplate } from "./templates";

// ШАБЛОНЫ ДОСТУПА — ЧТЕНИЕ И ЗАПИСЬ. Таблица `access_templates` открыта только
// владельцу компании (RLS); компания — из заголовка запроса, как везде.

export const accessTemplatesQueryKey = (tenantId: string | null) =>
  ["access-templates", tenantId] as const;

export function useAccessTemplates() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: accessTemplatesQueryKey(tenantId),
    enabled: !!tenantId,
    queryFn: async (): Promise<AccessTemplate[]> => {
      const { data, error } = await supabase
        .from("access_templates")
        .select("id, name, levels, position")
        .order("position")
        .order("name");
      if (error) throw new Error(error.message);
      return parseTemplates(data ?? []);
    },
  });
}

/** Новый шаблон — имя и (если есть) стартовые положения. Возвращает id. */
export function useCreateTemplate() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; levels?: Record<string, AccessLevel>; position: number }) => {
      if (!tenantId) throw new Error("Компания не выбрана");
      const { data, error } = await supabase
        .from("access_templates")
        .insert({
          tenant_id: tenantId,
          name: input.name,
          levels: (input.levels ?? {}) as Json,
          position: input.position,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: accessTemplatesQueryKey(tenantId) }),
  });
}

/** Правка имени или положений. Оптимистично: строка сменила слово под
 *  пальцем, отказ сервера возвращает прежнее. */
export function useUpdateTemplate() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const key = accessTemplatesQueryKey(tenantId);
  return useMutation({
    mutationFn: async (input: { id: string; name?: string; levels?: Record<string, AccessLevel> }) => {
      const patch: { name?: string; levels?: Json; updated_at: string } = {
        updated_at: new Date().toISOString(),
      };
      if (input.name !== undefined) patch.name = input.name;
      if (input.levels !== undefined) patch.levels = input.levels as Json;
      const { error } = await supabase.from("access_templates").update(patch).eq("id", input.id);
      if (error) throw new Error(error.message);
    },
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData<AccessTemplate[]>(key);
      qc.setQueryData<AccessTemplate[]>(key, (list) =>
        (list ?? []).map((t) =>
          t.id === input.id
            ? { ...t, name: input.name ?? t.name, levels: input.levels ?? t.levels }
            : t,
        ),
      );
      return { before };
    },
    onError: (_error, _input, context) => {
      if (context?.before) qc.setQueryData(key, context.before);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

export function useDeleteTemplate() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("access_templates").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: accessTemplatesQueryKey(tenantId) }),
  });
}
