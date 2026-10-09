import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { evictCompanyFromDevice } from "@/lib/evict-company";

// ВЫЙТИ ИЗ КОМАНДЫ САМОМУ (владелец 09.10: «добавить добавили, а выйти я уже
// не могу, если меня не удалят»). Сервер (`leave_calendar`) снимает партнёра
// с одной команды чужого аккаунта; последней командой — выводит из аккаунта
// целиком. Тогда аккаунт уходит с телефона тем же путём, что при удалении
// владельцем (`evictCompanyFromDevice`: увести в другой календарь, стереть
// его данные); сигнал сервера придёт следом и ничего не повторит.

export function useLeaveCalendar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { tenantId: string; teamId: string }) => {
      const { data, error } = await supabase.rpc("leave_calendar", {
        p_tenant_id: input.tenantId,
        p_team_id: input.teamId,
      });
      if (error) throw new Error(error.message);
      const leftAccount = Boolean((data as { left_account?: boolean } | null)?.left_account);
      if (leftAccount) await evictCompanyFromDevice(input.tenantId, { fresh: true });
      return { leftAccount };
    },
    // Команда ушла из ленты, из прав и из списков этого аккаунта — читаем
    // заново всё: шаг редкий, а свежесть важнее лишних запросов.
    onSuccess: () => void qc.invalidateQueries(),
    meta: { errorHandled: true },
  });
}
