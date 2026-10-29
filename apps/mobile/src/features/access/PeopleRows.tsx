import { Pressable, Text, View } from "react-native";
import { Mail } from "lucide-react-native";
import type { Database } from "@babun/shared/db/database.types";

import { useThemeColors } from "@/theme/colors";
import { readableForeground } from "@/theme/readable-color";

import { waitSubtitle } from "./invitation-wait";
import { LIST_ROW } from "@/components/ui/tokens";

// СТРОКИ ЛЮДЕЙ в «Партнёрах»: кто уже с доступом, карточки мастеров и кто
// ещё не ответил на приглашение. Ритм один: один список не должен выглядеть
// тремя.

type Invitation = Database["public"]["Tables"]["invitations"]["Row"];

/** Человек в списке — с доступом к календарю или карточка мастера: кружок
 *  инициалов цветом его команды, имя, подпись. `muted` — в архиве: кружок и
 *  текст бледные. Тап открывает его карточку. */
export function PersonRow({
  name,
  initials,
  sub,
  tint,
  muted = false,
  accessibilityLabel,
  onPress,
}: {
  name: string;
  initials: string;
  sub?: string;
  tint: string;
  muted?: boolean;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const t = useThemeColors();
  const circle = muted ? t.faint : tint;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      className="flex-row items-center px-4 py-3 active:opacity-60"
    >
      <View
        className="mr-3 h-10 w-10 items-center justify-center rounded-full"
        style={{ backgroundColor: circle }}
      >
        <Text style={{ fontSize: 14, fontWeight: "700", color: readableForeground(circle) }}>
          {initials}
        </Text>
      </View>
      <View className="flex-1">
        <Text style={{ ...LIST_ROW.name, color: muted ? t.faint : t.ink }} numberOfLines={1}>
          {name}
        </Text>
        {sub ? (
          <Text style={{ ...LIST_ROW.sub, color: muted ? t.faint : t.sub }} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** Приглашение, на которое ещё не ответили. Тап открывает его карточку
 *  (приглашение — та же полная карточка мастера); «Поделиться
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
        {/* Имя из приглашения; без имени строку по-прежнему называет почта. */}
        <Text style={{ ...LIST_ROW.name, color: t.ink }} numberOfLines={1}>
          {invitation.full_name || invitation.email}
        </Text>
        <Text style={{ ...LIST_ROW.sub, color: t.sub }} numberOfLines={1}>
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
