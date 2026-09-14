import { useRouter, type Href } from "expo-router";
import { Mail } from "lucide-react-native";

import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { useThemeColors } from "@/theme/colors";

import { useMyInvitations } from "./inbox-queries";

// «ПРИГЛАШЕНИЯ» — СТРОКА-ДВЕРЬ НА ПОСТОЯННОМ МЕСТЕ В КАБИНЕТЕ (STORY-081; место
// под картой человека выбирает 007). Блок, видный только при приглашениях,
// владелец не нашёл («а страницу приглашения ты сделал?»), поэтому дверь стоит
// всегда, а новые приглашения говорят красным числом справа — это канон
// строки-двери: «число справа… знак числа — единственный цвет в строке».
// Пузырь «как в играх» живёт на вкладке «Кабинет». Плитка зелёная: в словаре
// плиток это «наружу и вовне» — приглашения приходят из чужих компаний.
export function InvitationsRow() {
  const t = useThemeColors();
  const router = useRouter();
  const query = useMyInvitations();
  const count = query.data?.length ?? 0;
  return (
    <SettingsRow
      tile={SETTINGS_TILE.green}
      icon={Mail}
      title="Приглашения"
      sub={query.isSuccess ? (count > 0 ? "Ждут ответа" : "Новых нет") : undefined}
      value={count > 0 ? String(count) : undefined}
      valueColor={count > 0 ? t.danger : undefined}
      onPress={() => router.push("/cabinet/invitations" as Href)}
    />
  );
}
