import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getStorage } from "@babun/shared/storage";
import { SORT_ORDER, type SortKey } from "./filter";

// «Тихий лист 2» (владелец, 2026-07-22): сортировка — НЕ фильтр, а
// настройка списка. Живёт в «Настройки клиентов» и переживает перезапуск
// (device-local MMKV, конвенция card-prefs); из листа «Фильтры» удалена.

const KEY = "babun-clients-sort";

export function getClientsSort(): SortKey {
  try {
    const v = getStorage().get<string>(KEY);
    return SORT_ORDER.includes(v as SortKey) ? (v as SortKey) : "recent";
  } catch {
    // Storage seam ещё не инициализирован / повреждённое значение.
    return "recent";
  }
}

/** Живая сортировка списка — один query key, так что выбор в настройках
 *  мгновенно пересортировывает уже открытый список. */
export function useClientsSort() {
  return useQuery({
    queryKey: ["clients-sort"],
    queryFn: () => getClientsSort(),
    staleTime: Infinity,
  });
}

export function useSetClientsSort() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sort: SortKey) => {
      try {
        getStorage().set(KEY, sort);
      } catch {
        // Запись best-effort — падение кэша не должно ронять UI.
      }
      return sort;
    },
    onSuccess: (sort) => qc.setQueryData(["clients-sort"], sort),
  });
}
