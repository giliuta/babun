// Partner-only writes: each goes through its own server door.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { NEVER_PAUSE } from "@/features/finances/accounts";
import type { Json } from "@babun/shared/db/database.types";
import { supabase } from "@/lib/supabase";
import { referenceKeys } from "@/features/reference/query-keys";
import { invalidateKeys, useMemberRefusal } from "./shared";

/** КОПИЯ ЗАПИСИ СОТРУДНИКОМ — ТОЛЬКО В ЕЁ ЖЕ КОМАНДУ (владелец 30.09: «если
 *  я дал доступ в команду номер один, он может копировать только в этой
 *  команде»). Команды в вызове нет: сервер ставит копию туда же, где
 *  оригинал, по праву «Перенос записей» (`member_appointment_copy`). Копия
 *  делается на сервере с настоящей записи: у сотрудника скрытые поля
 *  приходят пустыми, и копия с телефона вышла бы без клиента и с нулями. */
export function useMemberCopyAppointment() {
  const qc = useQueryClient();
  const refusal = useMemberRefusal();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: async (input: {
      sourceId: string;
      date: string;
      timeStart: string;
      timeEnd: string;
      /** Номер копии с телефона: повтор после потерянного ответа вернёт уже
       *  вставшую копию, а не заведёт вторую (аудит 03.10). */
      id: string;
    }) => {
      const { data, error } = await supabase.rpc("member_appointment_copy", {
        p_source: input.sourceId,
        p_date: input.date,
        p_time_start: input.timeStart,
        p_time_end: input.timeEnd,
        p_id: input.id,
      });
      if (error) throw refusal("createAppointment", error.message);
      const id = (data as { id?: unknown } | null)?.id;
      return typeof id === "string" ? id : null;
    },
    onSuccess: () => {
      for (const key of invalidateKeys()) qc.invalidateQueries({ queryKey: key });
    },
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

/** НАСТРОЙКИ КОМАНДЫ СОТРУДНИКОМ (владелец 30.09: «даю доступ менять —
 *  значит он меняет всё в этом блоке»). Строку `teams` пишет только владелец;
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
