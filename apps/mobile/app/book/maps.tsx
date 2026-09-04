import ClientMapsScreen from "../(dashboard)/clients/maps";
import { RoleCapabilityBoundary } from "@/features/settings/RoleCapabilityBoundary";

// «Карты для маршрута», открытые ИЗ ЗАПИСИ — сиблинг записи, а не маршрут
// вкладки «Клиенты»: иначе «назад» уводит из записи и теряет набранное
// (см. `features/clients/reference-href.ts`). Экран тот же.
export default function BookMapsScreen() {
  return (
    <RoleCapabilityBoundary capability="operate-clients" title="Карты">
      <ClientMapsScreen />
    </RoleCapabilityBoundary>
  );
}
