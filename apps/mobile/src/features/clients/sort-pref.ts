import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getStorage } from "@babun/shared/storage";
import { DEFAULT_SORT, SORT_ORDER, type SortKey } from "./filter";

// Сортировка — НЕ фильтр, а настройка списка: переживает перезапуск
// (device-local MMKV, конвенция card-prefs) и не сбрасывается кнопкой
// «Сбросить». Выбирается ПЕРВОЙ строкой листа «Фильтры» (владелец
// 2026-07-25; из «Настроек клиентов» ряд удалён).

// «-v2» (03.10): умолчание сменилось на «По алфавиту», и прежний выбор
// «Недавний визит», записанный на устройстве, не должен его перекрыть.
// Префикс прежний — чистка при смене компании (`tenant-prefs.ts`) его
// по-прежнему узнаёт.
const KEY = "babun-clients-sort-v2";

function getClientsSort(): SortKey {
  try {
    const v = getStorage().get<string>(KEY);
    return SORT_ORDER.includes(v as SortKey) ? (v as SortKey) : DEFAULT_SORT;
  } catch {
    // Storage seam ещё не инициализирован / повреждённое значение.
    return DEFAULT_SORT;
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
    // Запись чисто локальная (MMKV) — без этого TanStack ставит мутацию в
    // офлайн-паузу, и в самолёте сортировка просто не переключается.
    networkMode: "always",
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
