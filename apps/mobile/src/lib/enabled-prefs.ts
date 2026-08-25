import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getStorage } from "@babun/shared/storage";
import { useTenantId } from "@/lib/tenant";

// «ЧТО ВООБЩЕ ПРЕДЛАГАТЬ И В КАКОМ ПОРЯДКЕ» — один механизм на все такие
// наборы: способы связи, что можно добавить, карты для маршрута.
//
// Хранится ДВА списка:
//   • enabled — что включено;
//   • order   — В КАКОМ ПОРЯДКЕ показывать (владелец 2026-08-02: «чтоб можно
//     было менять их местами — перетаскивать; допустим, после „Позвонить“
//     поднять наверх SMS»). Порядок общий для страницы настройки и для
//     листа на карточке: как выстроил, так и предлагается.
//
// `pinned` — пункты, которые всегда включены и всегда первыми («Позвонить»:
// без него кнопка связи теряет смысл, и таскать его некуда).
//
// Почему ПО ТЕНАНТУ: мастер работает на две фирмы с одного телефона, и
// выключенное/переставленное в одной не должно пропадать в другой.
// Почему местно (MMKV): это привычка ЭТОГО телефона, а не свойство фирмы.

export function createEnabledPrefs<T extends string>(opts: {
  /** Префикс ключа в MMKV; к нему приклеивается tenantId. */
  storageKey: string;
  /** Ключ кэша react-query. */
  queryKey: string;
  /** Все возможные значения в порядке ПО УМОЛЧАНИЮ. */
  all: readonly T[];
  /** Что включено, пока никто ничего не настраивал. */
  defaults: readonly T[];
  /** Всегда включены и всегда первыми; не выключаются и не двигаются. */
  pinned?: readonly T[];
  /** Нужен ли хотя бы один включённый пункт (иначе контрол умрёт). */
  requireOne?: boolean;
}) {
  const { storageKey, queryKey, all, defaults, requireOne } = opts;
  const pinned = opts.pinned ?? [];
  const key = (tenantId: string | null) =>
    tenantId ? `${storageKey}:${tenantId}` : storageKey;
  const orderKey = (tenantId: string | null) => `${key(tenantId)}:order`;

  /** Полный порядок всех пунктов: закреплённые сверху, затем сохранённый
   *  порядок, затем всё, чего в нём ещё нет (новый способ связи в обновлении
   *  не должен исчезнуть только потому, что порядок сохранён раньше). */
  const readOrder = (tenantId: string | null): T[] => {
    let saved: T[] = [];
    try {
      const raw = getStorage().get<string[]>(orderKey(tenantId));
      if (Array.isArray(raw)) saved = raw.filter((id) => all.includes(id as T)) as T[];
    } catch {
      saved = [];
    }
    const rest = all.filter((id) => !pinned.includes(id) && !saved.includes(id));
    return [
      ...pinned,
      ...saved.filter((id) => !pinned.includes(id)),
      ...rest,
    ];
  };

  /** Включённые — В ПОРЯДКЕ ПОКАЗА. */
  const read = (tenantId: string | null): T[] => {
    const order = readOrder(tenantId);
    let enabled: T[];
    try {
      const raw = getStorage().get<string[]>(key(tenantId));
      enabled = Array.isArray(raw)
        ? (raw.filter((id) => all.includes(id as T)) as T[])
        : [...defaults];
      if (enabled.length === 0 && requireOne) enabled = [...defaults];
    } catch {
      enabled = [...defaults];
    }
    // Закреплённое включено всегда, чем бы ни было записано раньше.
    const withPinned = [...new Set([...pinned, ...enabled])];
    return order.filter((id) => withPinned.includes(id));
  };

  const canDisable = (enabled: T[], id: T): boolean => {
    if (pinned.includes(id)) return false;
    return !requireOne || !enabled.includes(id) || enabled.length > 1;
  };

  /** Можно ли перетаскивать этот пункт. Закреплённый стоит первым всегда. */
  const canMove = (id: T): boolean => !pinned.includes(id);

  return {
    read,
    readOrder,
    canDisable,
    canMove,
    /** Включённые, в порядке показа. */
    use() {
      const tenantId = useTenantId();
      const { data } = useQuery({
        queryKey: [queryKey, tenantId],
        queryFn: () => read(tenantId),
        // MMKV читается синхронно — набор известен уже на первом кадре, и
        // тап не может попасть в пустой (=мёртвый) набор.
        initialData: () => read(tenantId),
        staleTime: Infinity,
      });
      return data;
    },
    /** Полный порядок — для страницы настройки (там видно и выключенное). */
    useOrder() {
      const tenantId = useTenantId();
      const { data } = useQuery({
        queryKey: [queryKey, tenantId, "order"],
        queryFn: () => readOrder(tenantId),
        initialData: () => readOrder(tenantId),
        staleTime: Infinity,
      });
      return data;
    },
    useToggle() {
      const qc = useQueryClient();
      const tenantId = useTenantId();
      return useMutation<T[], Error, T>({
        // Локальная запись — не должна ждать сети.
        networkMode: "always",
        mutationFn: async (id: T) => {
          const cur = read(tenantId);
          if (!canDisable(cur, id)) return cur;
          const next = cur.includes(id)
            ? cur.filter((x) => x !== id)
            : [...cur, id];
          const ordered = readOrder(tenantId).filter((x) => next.includes(x));
          try {
            getStorage().set(key(tenantId), ordered);
          } catch {
            // Запись best-effort.
          }
          return ordered;
        },
        onSuccess: (next) => qc.setQueryData([queryKey, tenantId], next),
      });
    },
    useReorder() {
      const qc = useQueryClient();
      const tenantId = useTenantId();
      return useMutation<T[], Error, T[]>({
        networkMode: "always",
        mutationFn: async (next: T[]) => {
          // Закреплённое возвращается в начало, что бы ни прислал экран.
          const ordered = [
            ...pinned,
            ...next.filter((id) => all.includes(id) && !pinned.includes(id)),
          ];
          const full = [
            ...ordered,
            ...all.filter((id) => !ordered.includes(id)),
          ];
          try {
            getStorage().set(orderKey(tenantId), full);
          } catch {
            // Запись best-effort.
          }
          return full;
        },
        onSuccess: (full) => {
          qc.setQueryData([queryKey, tenantId, "order"], full);
          // Порядок включённых меняется вместе с общим.
          qc.setQueryData([queryKey, tenantId], read(tenantId));
        },
      });
    },
  };
}
