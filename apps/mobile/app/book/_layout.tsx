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
// настроек календаря живут внутри вкладки «Календарь»).
//
// СТРАНИЦА ЗАПИСИ ОДНА ДЛЯ ВСЕХ (владелец 21.09; STORY-088): сотрудник
// открывает её так же, как владелец, поэтому ворота — «работает с
// календарём», а не «создаёт записи». Что можно на самой странице, решают
// блоки календаря записи (`bookRights`), а создание и правку держит сервер —
// дверями `member_appointment_*`.
export default function BookLayout() {
  const t = useThemeColors();
  return (
    <DashboardGate>
      <RoleCapabilityBoundary capability="operate-calendar" title="Запись">
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
