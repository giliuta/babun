import { useLocalSearchParams } from "expo-router";
import { InventoryList } from "../../inventory";

// Оборудование команды — web parity teams/[id]/equipment. Тонкая обёртка
// над общим экраном склада: тот же CRUD/редактор, но список сужен до
// позиций этой бригады (assigned_team_id), а «Добавить» сразу привязывает
// её (lockedTeamId).
export default function TeamEquipmentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <InventoryList lockedTeamId={id} />;
}
