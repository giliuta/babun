import { Pressable, Text, View } from "react-native";
import { Mail } from "lucide-react-native";
import { getInitials } from "@babun/shared/local/masters";
import type { Database } from "@babun/shared/db/database.types";

import { useThemeColors } from "@/theme/colors";
import { readableForeground } from "@/theme/readable-color";

import { waitSubtitle } from "./invitation-wait";
import type { CalendarMember } from "./queries";

// СТРОКИ ЛЮДЕЙ КАЛЕНДАРЯ в «Мастерах» (STORY-081): кто уже с доступом и кто
// ещё не ответил на приглашение. Ритм тот же, что у карточки мастера на экране:
// один список не должен выглядеть тремя.

type Invitation = Database["public"]["Tables"]["invitations"]["Row"];

/** Человек с доступом к календарю. Тап открывает его карточку. */
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

/** Приглашение, на которое ещё не ответили. Тап открывает его карточку
 *  (владелец 15.09: приглашение — та же полная карточка мастера); «Поделиться
 *  ссылкой» и «Отозвать» живут в ⋯ этой карточки, а не в меню строки. */
export function PendingInvitationRow({
  invitation,
  onPress,
}: {
  invitation: Invitation;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
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
          {/* СРОК НАЗЫВАЕТСЯ СРАЗУ. Приглашение живёт семь дней и молчало об
              этом: «Ждёт ответа» стояло и в первый день, и в седьмой
              (`invitation-wait.ts`). */}
          {invitation.full_name
            ? `${invitation.email} · ${waitSubtitle(invitation.expires_at, new Date())}`
            : capitalize(waitSubtitle(invitation.expires_at, new Date()))}
        </Text>
      </View>
    </Pressable>
  );
}

/** «ждёт ответа · осталось 3 дня» → «Ждёт ответа · осталось 3 дня». */
function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
