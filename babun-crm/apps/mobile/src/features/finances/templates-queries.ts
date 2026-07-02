import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  deleteFinanceTemplate,
  insertFinanceTemplate,
  listFinanceTemplates,
  type TemplateDraft,
} from "@babun/shared/db/repositories/finance-templates";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

export type { FinanceTemplate } from "@babun/shared/db/repositories/finance-templates";

export function useFinanceTemplates() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["finance-templates", tenantId],
    enabled: !!tenantId,
    queryFn: () => listFinanceTemplates(supabase, tenantId as string),
  });
}

export function useInsertTemplate() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: TemplateDraft) =>
      insertFinanceTemplate(supabase, tenantId as string, draft),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["finance-templates"] }),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteFinanceTemplate(supabase, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["finance-templates"] }),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}
