// Partner-only writes: each goes through its own server door.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { NEVER_PAUSE } from "@/features/finances/accounts";
import type { Json } from "@babun/shared/db/database.types";
import { supabase } from "@/lib/supabase";
import { referenceKeys } from "@/features/reference/query-keys";
import { invalidateKeys, useMemberRefusal } from "./shared";
import { useTenantId } from "@/lib/tenant";
import { sendOrQueue } from "@/lib/member-queue/runtime";
import { errorMessage as messageOf } from "@/lib/member-queue/plan";


/** КОПИЯ ЗАПИСИ СОТРУДНИКОМ — ТОЛЬКО В ЕЁ ЖЕ КОМАНДУ (доступ в одну команду не даёт копировать в
 *  другую). Команды в вызове нет: сервер ставит копию туда же, где
 *  оригинал, по праву «Перенос записей» (`member_appointment_copy`). Копия
 *  делается на сервере с настоящей записи: у сотрудника скрытые поля
 *  приходят пустыми, и копия с телефона вышла бы без клиента и с нулями. */
export function useMemberCopyAppointment() {
  const qc = useQueryClient();
  const tenantId = useTenantId();
  const refusal = useMemberRefusal();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: async (input: {
      sourceId: string;
      date: string;
      timeStart: string;
      timeEnd: string;
      /** Номер копии с телефона: повтор после потерянного ответа вернёт уже
       *  вставшую копию, а не заведёт вторую. */
      id: string;
    }) => {
      const args = {
        p_source: input.sourceId,
        p_date: input.date,
        p_time_start: input.timeStart,
        p_time_end: input.timeEnd,
        p_id: input.id,
      };
      // Без сети копия ждёт в очереди телефона (`lib/member-queue`); на сетку
      // она встанет, когда сервер её сделает — поля копирует он.
      try {
        const sent = await sendOrQueue({
          tenantId: tenantId as string,
          recordId: input.id,
          kind: "copy",
          args,
          label: "Копия записи",
          send: async () => {
            const { data, error } = await supabase.rpc("member_appointment_copy", args);
            if (error) throw error;
            return data;
          },
        });
        if (sent.queued) return input.id;
        const id = (sent.data as { id?: unknown } | null)?.id;
        return typeof id === "string" ? id : null;
      } catch (error) {
        throw refusal("createAppointment", messageOf(error));
      }
    },
    onSuccess: () => {
      for (const key of invalidateKeys()) qc.invalidateQueries({ queryKey: key });
    },
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

/** НАСТРОЙКИ КОМАНДЫ СОТРУДНИКОМ (доступ «меняет» — это весь блок). Строку `teams` пишет только владелец;
 *  сотрудник меняет поле команды через `member_update_team`, и сервер
 *  пускает каждое поле по праву его строки в «Настройках команды». */
export function useMemberUpdateTeam() {
  const qc = useQueryClient();
  const refusal = useMemberRefusal();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: async (input: { teamId: string; patch: Record<string, unknown> }) => {
      const { error } = await supabase.rpc("member_update_team", {
        p_team: input.teamId,
        p_patch: input.patch as Json,
      });
      if (error) throw refusal("updateTeam", error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: referenceKeys.teamAll() });
    },
    meta: { errorHandled: true }, // call sites alert themselves
  });
}
