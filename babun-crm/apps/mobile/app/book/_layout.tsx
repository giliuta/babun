import { Stack } from "expo-router";
import { useThemeColors } from "@/theme/colors";
import { DashboardGate } from "@/lib/DashboardGate";
import { RoleCapabilityBoundary } from "@/features/settings/RoleCapabilityBoundary";

// «Новая запись» — отдельный МАРШРУТ создания заявки/события, сиблинг табов
// в корневом стеке (как /calendar). Тап по свободному слоту календаря
// раньше открывал попап-поверх-попапа (SlotConfirmPopup → AppointmentSheet
// как две шторки); теперь он push-ит сюда — реальная страница с адресом в
// стеке, «назад» возвращает на календарь. Живёт над таб-баром, поэтому не
// переключает вкладку под пальцем и не двоит «назад» (тот же приём, что у
// настроек календаря — см. app/calendar/_layout.tsx).
export default function BookLayout() {
  const t = useThemeColors();
  return (
    <DashboardGate>
      <RoleCapabilityBoundary capability="create-appointment" title="Новая запись">
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: t.canvas },
          }}
        />
      </RoleCapabilityBoundary>
    </DashboardGate>
  );
}
