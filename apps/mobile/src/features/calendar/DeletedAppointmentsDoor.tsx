import { useRouter, type Href } from "expo-router";
import { Trash2 } from "lucide-react-native";
import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { useCurrentRole } from "@/features/settings/tenant";
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
export function DeletedAppointmentsDoor({ teamId }: { teamId: string }) {
  const router = useRouter();
  const owner = useCurrentRole().data === "owner";
  const actions = useCalendarActionsReader()(teamId);
  const allowed = owner || actions.cancel || actions.events === "write";
  const deleted = useDeletedAppointments();
  if (!allowed) return null;
  return (
    <SectionCard>
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
    </SectionCard>
  );
}
