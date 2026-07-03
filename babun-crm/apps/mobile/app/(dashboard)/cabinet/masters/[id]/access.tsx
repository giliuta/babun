import { View } from "react-native";
import { ShieldCheck } from "lucide-react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";

// Заглушка «Доступы» — полная матрица прав (PERMISSION_GROUPS + пресеты +
// visible_team_ids → profile.permissions) собирается в слайсе 3. Маршрут
// существует уже сейчас, чтобы nav-строка «Доступы» из хаба не была мёртвой.
export default function MasterAccessScreen() {
  const t = useThemeColors();
  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Доступы" />
      <View className="flex-1">
        <EmptyState
          fill
          title="Скоро"
          subtitle="Настройка прав мастера появится здесь."
          icon={<ShieldCheck color={t.faint} size={ICON.lg} />}
        />
      </View>
    </Screen>
  );
}
