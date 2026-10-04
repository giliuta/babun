import type { createEnabledPrefs } from "@/lib/enabled-prefs";
import { useDesignBase } from "@/features/appointments/booking-prefs";
import {
  useSaveTeamDesign,
  useTeamDesign,
  type TeamDesign,
} from "@/features/appointments/team-design";

// НАБОР КОМАНДЫ НА СЕРВЕРЕ, НАБОР ТЕЛЕФОНА — ЗАПАСНОЙ (владелец 30.09:
// «способы связи и карты — всё должно правильно проходить»). «Способы связи»
// и «Карты для маршрута» команды лежат в `team_design`: владелец настроил —
// у всех людей команды так же. Пока команда на сервере не настраивала
// (`null`), берётся прежний набор с телефона (`enabled-prefs`); первая же
// правка записывает текущий набор на сервер вместе с правкой.

type Prefs<T extends string> = ReturnType<typeof createEnabledPrefs<T>>;
type Field = "contactWays" | "mapServices";

export function teamOrderedSet<T extends string>(prefs: Prefs<T>, field: Field) {
  const serverOf = (design: TeamDesign | null, teamId: string | null) =>
    teamId && design ? prefs.fromServer(design[field]) : null;

  /** Текущий набор команды: сервер, иначе телефон. */
  function useCurrent(teamId: string | null) {
    const localEnabled = prefs.use(teamId);
    const localOrder = prefs.useOrder(teamId);
    const design = useTeamDesign(teamId);
    const server = serverOf(design, teamId);
    return server ?? { enabled: localEnabled, order: localOrder };
  }

  /** Записать набор команды на сервер (строка `team_design`, владелец). */
  function useWrite(teamId: string | null) {
    const base = useDesignBase(teamId);
    const save = useSaveTeamDesign();
    return {
      isPending: save.isPending,
      write: (next: { enabled: T[]; order: T[] }) => {
        if (!teamId) return;
        save.mutate({ teamId, base, next: { ...base, [field]: next } });
      },
    };
  }

  return {
    /** Включённые, в порядке показа. */
    use(teamId: string | null = null): T[] {
      return useCurrent(teamId).enabled;
    },
    /** Полный порядок — для страницы настройки. */
    useOrder(teamId: string | null = null): T[] {
      return useCurrent(teamId).order;
    },
    useToggle(teamId: string | null = null) {
      const current = useCurrent(teamId);
      const local = prefs.useToggle(teamId);
      const server = useWrite(teamId);
      return {
        isPending: local.isPending || server.isPending,
        mutate: (id: T) => {
          // Без команды — прежний набор телефона.
          if (!teamId) return local.mutate(id);
          if (!prefs.canDisable(current.enabled, id)) return;
          const on = new Set(current.enabled);
          if (on.has(id)) on.delete(id);
          else on.add(id);
          server.write({
            enabled: current.order.filter((x) => on.has(x)),
            order: current.order,
          });
        },
      };
    },
    useReorder(teamId: string | null = null) {
      const current = useCurrent(teamId);
      const local = prefs.useReorder(teamId);
      const server = useWrite(teamId);
      return {
        isPending: local.isPending || server.isPending,
        mutate: (next: T[]) => {
          if (!teamId) return local.mutate(next);
          const normalized = prefs.fromServer({ enabled: current.enabled, order: next });
          if (normalized) server.write(normalized);
        },
      };
    },
  };
}
