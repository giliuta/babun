import { Text, View } from "react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { Divider } from "@/components/ui/Divider";
import { Button } from "@/components/ui/Button";
import { useSession } from "@/providers/SessionProvider";
import { useThemeColors } from "@/theme/colors";
import { signOutAndWipe } from "@/lib/auth-clear";

function Row({ label, value }: { label: string; value: string }) {
  const t = useThemeColors();
  return (
    <View className="px-4 py-3">
      <Text style={{ fontSize: 12, color: t.faint }}>{label}</Text>
      <Text style={{ marginTop: 2, fontSize: 16, color: t.ink }} selectable>
        {value}
      </Text>
    </View>
  );
}

export default function AccountScreen() {
  const { session } = useSession();
  const u = session?.user;
  const registered = u?.created_at
    ? new Date(u.created_at).toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "—";

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Аккаунт" />
      <SectionCard>
        <Row label="Email" value={u?.email ?? "—"} />
        <Divider inset={16} />
        <Row label="Зарегистрирован" value={registered} />
        <Divider inset={16} />
        <Row label="ID пользователя" value={u?.id ?? "—"} />
      </SectionCard>

      <View className="mx-3 mt-6">
        <Button
          label="Выйти"
          variant="secondary"
          tone="danger"
          // Same intentional-logout path as the cabinet hub: a bare
          // signOut() would keep all tenant data in MMKV on a shared
          // device (bare SIGNED_OUT events deliberately never wipe).
          onPress={() => void signOutAndWipe()}
        />
      </View>
    </Screen>
  );
}
