import { useRouter, type Href } from "expo-router";
import { Archive } from "lucide-react-native";
import { formatCountRu } from "@babun/shared/common/utils/plural-ru";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { useTeams } from "@/features/reference/queries";

// СТРОКА «АРХИВ» В КАБИНЕТЕ (владелец 2026-09-21: «если я нажимаю Кабинет,
// там есть вкладка „Архив“, и уже в архиве полностью всё это есть»).
//
// Подпись — живое состояние, а не пояснение (закон Кабинета): сколько
// календарей лежит в архиве сейчас. Пустой архив так и называется — строка
// остаётся на месте, чтобы дорогу туда не приходилось искать.
export function ArchiveRow() {
  const router = useRouter();
  const { data: teams = [] } = useTeams({ includeInactive: true });
  const archived = teams.filter((team) => !team.is_active).length;

  return (
    <SettingsRow
      tile="neutral"
      icon={Archive}
      title="Архив"
      sub={
        archived > 0
          ? formatCountRu(archived, ["календарь", "календаря", "календарей"])
          : "Пусто"
      }
      onPress={() => router.push("/cabinet/archive" as Href)}
    />
  );
}
