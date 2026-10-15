import { useCallback } from "react";
import {
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useDataRole } from "@/session/tenant";
import { referenceKeys } from "../query-keys";
import { assertCanWriteReference } from "./ref-write";

/** СКОЛЬКО ЗАПИСЕЙ ССЫЛАЮТСЯ НА УСЛУГУ.
 *
 *  Нужен ровно одному месту — подтверждению перед НАСТОЯЩИМ удалением. Связи
 *  с таблицей у услуги нет: `appointments.service_ids` это jsonb-массив, и
 *  база удалению не помешает. Значит спросить обязан продукт, иначе человек
 *  сотрёт услугу и молча обнулит имя работы в своей же истории. */
export function useServiceUsageCount() {
  const tenantId = useTenantId();
  return useCallback(
    async (serviceId: string): Promise<number> => {
      if (!tenantId) return 0;
      // `.contains([...])` ЗДЕСЬ НЕ РАБОТАЕТ, и это не мелочь: supabase-js
      // сериализует массив как МАССИВ POSTGRES (`cs.{...}`), а `service_ids`
      // это `jsonb` — ему нужен JSON (`cs.[...]`). Запрос падал, счёт
      // возвращался неизвестным, и подтверждение печатало запасное «может
      // стоять в записях» вместо числа. Поймано на симуляторе.
      const { count, error } = await supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .filter("service_ids", "cs", JSON.stringify([serviceId]));
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
    [tenantId],
  );
}

/** НАСТОЯЩЕЕ УДАЛЕНИЕ УСЛУГИ — строка уходит из базы совсем.
 *
 *  Отдельно от `useDeleteService`, и это НЕ дубль: тот выключает
 *  (`is_active = false`), услуга остаётся в списке серой, история цела.
 *  Этот стирает — и вместе со строкой пропадает имя работы во всех уже
 *  сделанных записях и счетах, потому что называть их станет нечем.
 *  Удалить услугу совсем и выключить её — разные вещи. */
export function usePurgeService() {
  const qc = useQueryClient();
  const tenantId = useTenantId();
  const role = useDataRole().data;
  return useMutation({
    mutationFn: async (id: string) => {
      if (!tenantId) throw new Error("Нет активного аккаунта.");
      assertCanWriteReference("services", role);
      const { error } = await supabase
        .from("services")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: referenceKeys.table("services") }),
    meta: { errorHandled: true },
  });
}
