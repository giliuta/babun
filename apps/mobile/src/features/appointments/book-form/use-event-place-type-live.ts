import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { isMissingTypeColumn } from "./event-place";

/** ЕСТЬ ЛИ НА СЕРВЕРЕ КОЛОНКА ТИПА ОБЪЕКТА СОБЫТИЯ
 *  (`appointments.address_object_type_id`, накат 20261030120000). До наката
 *  строки «Тип объекта» у объекта события нет и поле в запись не уходит —
 *  иначе сохранение события упало бы на незнакомой колонке. Проба — одна
 *  строка с одной колонкой, раз за сессию; обрыв сети — «нет», не ошибка. */
export function useEventPlaceTypeLive(): boolean {
  const { data } = useQuery({
    queryKey: ["schema", "appointments.address_object_type_id"],
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    queryFn: async () => {
      const { error } = await supabase
        .from("appointments")
        .select("address_object_type_id" as "id")
        .limit(1);
      if (!error) return true;
      if (isMissingTypeColumn(error)) return false;
      throw new Error(error.message);
    },
  });
  return data === true;
}
