import { useRouter, type Href } from "expo-router";
import { Package } from "lucide-react-native";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";

// «СКЛАД ОБОРУДОВАНИЯ» — СТРОКА-ДВЕРЬ КАБИНЕТА. Склад один на аккаунт:
// позиция живёт в аккаунте и закрепляется за командой, поэтому ей место
// рядом с «Реквизитами», а не в шестерёнке одной команды.
//
// Раздел пока в разработке: экран за дверью говорит это словами и ничего не
// читает, поэтому подпись — то же состояние, а не число позиций. Строка стоит
// только в своём аккаунте (`OwnAccountSection`); писать в склад сервер даёт
// только владельцу (`equipment_write_owner`), право «Склад» у партнёра не
// включено.
export function InventoryCabinetRow() {
  const router = useRouter();
  return (
    <SettingsRow
      tile={SETTINGS_TILE.yellow}
      icon={Package}
      title="Склад оборудования"
      sub="В разработке"
      onPress={() => router.push("/cabinet/inventory" as Href)}
    />
  );
}
