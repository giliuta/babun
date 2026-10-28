import { useRouter, type Href } from "expo-router";
import { Trash2 } from "lucide-react-native";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { useCurrentRole } from "@/session/tenant";
import { useCalendarActionsReader } from "@/features/appointments/useRecordRights";
import { useDeletedAppointments } from "./deleted-appointments";
import { deletedAppointmentsDoorLine } from "./deleted-appointments-lines";

// ДВЕРЬ «УДАЛЁННЫЕ ЗАПИСИ» В ШЕСТЕРЁНКЕ КАЛЕНДАРЯ — как «Удалённые
// операции» в шестерёнке «Финансов»: красная плитка корзины, подпись —
// сколько в ящике у открытого календаря.
//
// Право (AGENTS 10): строка есть у того, кто может удалять в этом календаре —
// владелец; сотрудник с «Отменять и удалять» или «События: Меняет». Без
// права строки нет. Сервер держит ящик своей RLS (миграция 20261016170000).
// ХУК, а не компонент: строка ложится в общую карточку шестерёнки
// (`SettingsGroup`), и шов рисуется, только если строка есть.
export function useDeletedAppointmentsRow(teamId: string | null) {
  const router = useRouter();
  const owner = useCurrentRole().data === "owner";
  const actions = useCalendarActionsReader()(teamId);
  const allowed = owner || actions.cancel || actions.events === "write";
  const deleted = useDeletedAppointments();
  if (!teamId || !allowed) return null;
  return (
      <SettingsRow
        tile={SETTINGS_TILE.red}
        icon={Trash2}
        title="Удалённые записи"
        sub={
          deleted.data
            ? deletedAppointmentsDoorLine(deleted.data.filter((item) => item.teamId === teamId).length)
            : undefined
        }
        onPress={() =>
          router.push({ pathname: "/calendar/deleted", params: { team: teamId } } as Href)
        }
      />
  );
}
