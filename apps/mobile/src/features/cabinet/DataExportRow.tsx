import { useRouter, type Href } from "expo-router";
import { Download } from "lucide-react-native";

import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";

// «ВЫГРУЗКА ДАННЫХ» — СТРОКА-ДВЕРЬ КАБИНЕТА (владелец 03.10: «выгрузить все
// данные можно, но только из своих личных команд»). Дверь в корне одна и
// видна всем; кому выгружать нельзя, об этом говорит сама страница.
export function DataExportRow() {
  const router = useRouter();
  return (
    <SettingsRow
      tile={SETTINGS_TILE.blue}
      icon={Download}
      title="Выгрузка данных"
      sub="Клиенты, записи, финансы"
      onPress={() => router.push("/cabinet/export" as Href)}
    />
  );
}
