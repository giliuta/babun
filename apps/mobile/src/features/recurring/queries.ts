import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createRecurringReminder,
  deleteRecurringReminder,
  listRecurringReminders,
  updateReminderStatus,
} from "@babun/shared/db/repositories/recurring-reminders";
import type {
  CreateRecurringInput,
  RecurringStatus,
} from "@babun/shared/local/recurring";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

export type {
  RecurringReminder,
  RecurringStatus,
} from "@babun/shared/local/recurring";

export function useRecurringReminders() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["recurring", tenantId],
    enabled: !!tenantId,
    queryFn: () => listRecurringReminders(supabase, tenantId as string),
  });
}

export function useCreateReminder() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRecurringInput) =>
      createRecurringReminder(supabase, tenantId as string, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurring"] }),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

export function useUpdateReminderStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: RecurringStatus }) =>
      updateReminderStatus(supabase, id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurring"] }),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

export function useDeleteReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteRecurringReminder(supabase, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurring"] }),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}
