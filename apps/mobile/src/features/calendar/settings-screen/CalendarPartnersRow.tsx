import { useMemo } from "react";
import { useRouter, type Href } from "expo-router";
import { Users } from "lucide-react-native";
import { formatCountRu } from "@babun/shared/common/utils/plural-ru";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { useCompanyMembers } from "@/session/access-queries";
import { usePendingInvitations } from "@/features/settings/team-access";

// СТРОКА «ПАРТНЁРЫ» В ШЕСТЕРЁНКЕ КАЛЕНДАРЯ — люди ЭТОГО календаря:
// приглашают прямо в календарь, а не в аккаунт. Подпись — живое состояние:
// сколько людей в календаре и сколько ждут ответа на приглашение.
// Видимость строки решает вызывающий (`usePartnersAccess().sees`): у
// шестерёнки карточка собирается из видимых строк.
export function CalendarPartnersRow({ teamId }: { teamId: string }) {
  const router = useRouter();
  const members = useCompanyMembers().data;
  const invitations = usePendingInvitations().data;
  const sub = useMemo(() => {
    if (!members) return undefined;
    const people = members.filter((member) => member.role !== "owner" && member.calendars.includes(teamId)).length;
    const waiting = (invitations ?? []).filter(
      (inv) => inv.team_id === teamId || (inv.team_ids ?? []).includes(teamId),
    ).length;
    const base = people > 0 ? formatCountRu(people, ["партнёр", "партнёра", "партнёров"]) : "Пока никого";
    return waiting > 0 ? `${base} · ждут ответа: ${waiting}` : base;
  }, [members, invitations, teamId]);
  return (
    <SettingsRow
      tile={SETTINGS_TILE.indigo}
      icon={Users}
      title="Партнёры"
      sub={sub}
      onPress={() => router.push(`/calendar/partners?team=${encodeURIComponent(teamId)}` as Href)}
    />
  );
}
