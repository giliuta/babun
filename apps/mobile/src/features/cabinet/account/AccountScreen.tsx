import { useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { KeyboardLift } from "@/components/ui/KeyboardLift";
import { ChevronRight } from "lucide-react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { Divider } from "@/components/ui/Divider";
import { ICON } from "@/components/ui/tokens";
import { useSession } from "@/providers/SessionProvider";
import { useThemeColors } from "@/theme/colors";
import { ChangeEmailSheet } from "@/features/cabinet/ChangeEmailSheet";
import { DangerZoneSection } from "./DangerZoneSection";
import { DevicesSection } from "./DevicesSection";
import { PasswordSection } from "./PasswordSection";

function Row({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string;
  /** Строка-дверь: шеврон справа, тап открывает правку (почта, 04.10). */
  onPress?: () => void;
}) {
  const t = useThemeColors();
  const body = (
    <View className="flex-1">
      <Text style={{ fontSize: 12, color: t.faint }}>{label}</Text>
      <Text style={{ marginTop: 2, fontSize: 16, color: t.ink }} selectable={!onPress}>
        {value}
      </Text>
    </View>
  );
  if (!onPress) return <View className="px-4 py-3">{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      className="flex-row items-center px-4 py-3"
      style={({ pressed }) => ({ backgroundColor: pressed ? t.pressed : "transparent" })}
    >
      {body}
      <ChevronRight size={ICON.sm} color={t.faint} />
    </Pressable>
  );
}

export function AccountScreen() {
  const { session } = useSession();
  const u = session?.user;
  const [emailSheet, setEmailSheet] = useState(false);
  const registered = u?.created_at
    ? new Date(u.created_at).toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "—";

  return (
    <Screen edges={["top"]}>
      {/* Шапка = строка Кабинета, которой сюда пришли (аудит 03.10). */}
      <ScreenHeader title="Вход и безопасность" />
      <KeyboardLift
        style={{ flex: 1 }}
      >
        <ScrollView
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 32 }}
        >
          <SectionCard>
            <Row
              label="Email"
              value={u?.email ?? "—"}
              onPress={u?.email ? () => setEmailSheet(true) : undefined}
            />
            <Divider inset={16} />
            <Row label="Зарегистрирован" value={registered} />
            <Divider inset={16} />
            <Row label="ID пользователя" value={u?.id ?? "—"} />
          </SectionCard>

          <PasswordSection email={u?.email ?? null} />
          <DevicesSection />
          <DangerZoneSection email={u?.email ?? ""} />
        </ScrollView>
      </KeyboardLift>
      <ChangeEmailSheet
        visible={emailSheet}
        onClose={() => setEmailSheet(false)}
        currentEmail={u?.email ?? ""}
      />
    </Screen>
  );
}
