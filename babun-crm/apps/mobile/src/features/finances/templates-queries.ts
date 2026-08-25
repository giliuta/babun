import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  deleteFinanceTemplate,
  insertFinanceTemplate,
  listFinanceTemplates,
  updateFinanceTemplate,
  type TemplateDraft,
} from "@babun/shared/db/repositories/finance-templates";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { NEVER_PAUSE } from "./accounts";

export type { FinanceTemplate } from "@babun/shared/db/repositories/finance-templates";

export function useFinanceTemplates() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["finance-templates", tenantId],
    enabled: !!tenantId,
    queryFn: () => listFinanceTemplates(supabase, tenantId as string),
  });
}

// Шаблоны — справочник, но запись всё равно онлайн-only: без NEVER_PAUSE
// офлайн-вызов встаёт в paused, mutateAsync не резолвится, и кнопка
// сохранения крутится вечно без ошибки (см. комментарий в accounts.ts).
export function useInsertTemplate() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: (draft: TemplateDraft) =>
      insertFinanceTemplate(supabase, tenantId as string, draft),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["finance-templates"] }),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

export function useUpdateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: ({ id, patch }: { id: string; patch: Partial<TemplateDraft> }) =>
      updateFinanceTemplate(supabase, id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["finance-templates"] }),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: (id: string) => deleteFinanceTemplate(supabase, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["finance-templates"] }),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}
