import ClientChannelsScreen from "../(dashboard)/clients/channels";
import { RoleCapabilityBoundary } from "@/features/settings/RoleCapabilityBoundary";

// «Связь» (до 03.10 — «Способы связи»), открытая ИЗ ЗАПИСИ (карточка клиента
// над ней) — сиблинг записи, а не маршрут вкладки «Клиенты»: иначе «назад»
// уводит из записи и теряет набранное (см. `features/clients/reference-href.ts`).
// Экран тот же.
export default function BookChannelsScreen() {
  return (
    <RoleCapabilityBoundary capability="operate-clients" title="Связь">
      <ClientChannelsScreen />
    </RoleCapabilityBoundary>
  );
}
