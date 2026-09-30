import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getStorage } from "@babun/shared/storage";
import {
  createEnabledPrefsStore,
  type EnabledPrefsOptions,
} from "@/lib/enabled-prefs-core";
import { useTenantId } from "@/lib/tenant";
import { useClientsScopeOrNull } from "@/features/clients/company-scope";

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

// НАБОРЫ ПОКАЗА ЖИВУТ У КОМПАНИИ, А КОМПАНИЯ — У ЭКРАНА.
//
// Способы связи и картографические сервисы хранятся на устройстве ключом
// компании. Вкладка «Клиенты» открывается в СВОЕЙ компании, даже когда в
// календаре стоит чужая (STORY-082): иначе «Настройки клиентов» показали бы
// способы связи чужой компании и там же их и переставляли. Вне вкладки
// источника нет — берётся активная компания, как раньше.
function usePrefsTenantId(): string | null {
  const scope = useClientsScopeOrNull();
  const activeTenantId = useTenantId();
  return scope?.tenantId ?? activeTenantId;
}

export function createEnabledPrefs<T extends string>(opts: EnabledPrefsOptions<T>) {
  const { queryKey } = opts;
  const store = createEnabledPrefsStore(opts);
  const {
    all,
    pinned,
    key,
    orderKey,
    rememberKnown,
    read,
    readOrder,
    seedTeam,
    fromServer,
    canDisable,
    canMove,
  } = store;

  return {
    read,
    readOrder,
    fromServer,
    canDisable,
    canMove,
    /** Включённые, в порядке показа. `teamId` — набор этой команды (пока
     *  своего нет — набор компании); без него — набор компании. */
    use(teamId: string | null = null) {
      const tenantId = usePrefsTenantId();
      const { data } = useQuery({
        queryKey: [queryKey, tenantId, teamId],
        queryFn: () => read(tenantId, teamId),
        // MMKV читается синхронно — набор известен уже на первом кадре, и
        // тап не может попасть в пустой (=мёртвый) набор.
        initialData: () => read(tenantId, teamId),
        staleTime: Infinity,
      });
      return data;
    },
    /** Полный порядок — для страницы настройки (там видно и выключенное). */
    useOrder(teamId: string | null = null) {
      const tenantId = usePrefsTenantId();
      const { data } = useQuery({
        queryKey: [queryKey, tenantId, teamId, "order"],
        queryFn: () => readOrder(tenantId, teamId),
        initialData: () => readOrder(tenantId, teamId),
        staleTime: Infinity,
      });
      return data;
    },
    useToggle(teamId: string | null = null) {
      const qc = useQueryClient();
      const tenantId = usePrefsTenantId();
      return useMutation<T[], Error, T>({
        // Локальная запись — не должна ждать сети.
        networkMode: "always",
        mutationFn: async (id: T) => {
          seedTeam(tenantId, teamId);
          const cur = read(tenantId, teamId);
          if (!canDisable(cur, id)) return cur;
          const next = cur.includes(id)
            ? cur.filter((x) => x !== id)
            : [...cur, id];
          const ordered = readOrder(tenantId, teamId).filter((x) => next.includes(x));
          try {
            getStorage().set(key(tenantId, teamId), ordered);
          } catch {
            // Запись best-effort.
          }
          rememberKnown(tenantId, teamId);
          return ordered;
        },
        onSuccess: (next) => qc.setQueryData([queryKey, tenantId, teamId], next),
      });
    },
    useReorder(teamId: string | null = null) {
      const qc = useQueryClient();
      const tenantId = usePrefsTenantId();
      return useMutation<T[], Error, T[]>({
        networkMode: "always",
        mutationFn: async (next: T[]) => {
          seedTeam(tenantId, teamId);
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
            getStorage().set(orderKey(tenantId, teamId), full);
          } catch {
            // Запись best-effort.
          }
          return full;
        },
        onSuccess: (full) => {
          qc.setQueryData([queryKey, tenantId, teamId, "order"], full);
          // Порядок включённых меняется вместе с общим.
          qc.setQueryData([queryKey, tenantId, teamId], read(tenantId, teamId));
        },
      });
    },
  };
}
