import { Pressable, Text, View } from "react-native";
import { Mail } from "lucide-react-native";
import { getInitials } from "@babun/shared/local/masters";
import type { Database } from "@babun/shared/db/database.types";

import { presentChoiceSheet } from "@/components/ui/ChoiceSheet";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import { useRevokeInvitation } from "@/features/settings/team-access";
import { useTenant } from "@/features/settings/tenant";
import { useThemeColors } from "@/theme/colors";
import { readableForeground } from "@/theme/readable-color";

import { shareInvitation, waitSheetExit } from "./InviteMemberSheet";
import type { CalendarMember } from "./queries";

// СТРОКИ ЛЮДЕЙ КАЛЕНДАРЯ в «Мастерах» (STORY-081): кто уже с доступом и кто
// ещё не ответил на приглашение. Ритм тот же, что у карточки мастера на экране:
// один список не должен выглядеть тремя.

type Invitation = Database["public"]["Tables"]["invitations"]["Row"];

/** Человек с доступом к календарю. Тап открывает его права. */
export function MemberRow({
  member,
  tint,
  onPress,
}: {
  member: CalendarMember;
  tint: string;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${member.name}, права доступа`}
      className="flex-row items-center px-4 py-3 active:opacity-60"
    >
      <View
        className="mr-3 h-10 w-10 items-center justify-center rounded-full"
        style={{ backgroundColor: tint }}
      >
        <Text style={{ fontSize: 14, fontWeight: "700", color: readableForeground(tint) }}>
          {getInitials(member.name)}
        </Text>
      </View>
      <View className="flex-1">
        <Text style={{ fontSize: 16, fontWeight: "600", color: t.ink }} numberOfLines={1}>
          {member.name}
        </Text>
        <Text style={{ fontSize: 14, color: t.sub }} numberOfLines={1}>
          {member.email}
        </Text>
      </View>
    </Pressable>
  );
}

/** Приглашение, на которое ещё не ответили. Приглашённый видит его у себя в
 *  Кабинете; тап здесь — поделиться ссылкой (если аккаунта ещё нет) или отозвать. */
export function PendingInvitationRow({ invitation }: { invitation: Invitation }) {
  const t = useThemeColors();
  const tenantQuery = useTenant();
  const revoke = useRevokeInvitation();

  const openActions = async () => {
    const picked = await presentChoiceSheet(invitation.email, [
      { label: "Поделиться ссылкой" },
      { label: "Отозвать приглашение", destructive: true },
    ]);
    if (picked === 0) {
      await waitSheetExit();
      await shareInvitation({
        email: invitation.email,
        token: invitation.token,
        tenantName: tenantQuery.data?.name,
      }).catch(() => notify("Не удалось открыть «Поделиться»", "Попробуйте ещё раз."));
      return;
    }
    if (picked === 1) {
      // Вопрос — только после того, как выбор уехал: второе окно поверх
      // уезжающего не появляется вовсе.
      await waitSheetExit();
      confirmThen(
        "Отозвать приглашение?",
        {
          message: `Ссылка для ${invitation.email} перестанет работать.`,
          confirmLabel: "Отозвать",
          destructive: true,
        },
        async () => {
          try {
            await revoke.mutateAsync(invitation.id);
          } catch (error) {
            notify("Не удалось отозвать", (error as Error).message);
          }
        },
      );
    }
  };

  return (
    <Pressable
      onPress={() => void openActions()}
      accessibilityRole="button"
      accessibilityLabel={`${invitation.full_name || invitation.email}, ждёт ответа`}
      className="flex-row items-center px-4 py-3 active:opacity-60"
    >
      <View
        className="mr-3 h-10 w-10 items-center justify-center rounded-full"
        style={{ backgroundColor: t.fill }}
      >
        <Mail color={t.faint} size={18} />
      </View>
      <View className="flex-1">
        {/* Имя из приглашения (владелец 15.09: «мини-информация о человеке»);
            без имени строку по-прежнему называет почта. */}
        <Text style={{ fontSize: 16, fontWeight: "600", color: t.ink }} numberOfLines={1}>
          {invitation.full_name || invitation.email}
        </Text>
        <Text style={{ fontSize: 14, color: t.sub }} numberOfLines={1}>
          {invitation.full_name ? `${invitation.email} · ждёт ответа` : "Ждёт ответа"}
        </Text>
      </View>
    </Pressable>
  );
}
