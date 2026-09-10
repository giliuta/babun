import { ScrollView } from "react-native";
import { usePathname, useRouter, type Href } from "expo-router";
import { LayoutList, Tags } from "lucide-react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { Divider } from "@/components/ui/Divider";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { haptics } from "@/lib/haptics";
import {
  BOOKING_BLOCKS,
  useBookingBlocks,
} from "@/features/appointments/booking-prefs";
import { usePersonalEventTypes } from "@/features/settings/local-settings";

// «СТРАНИЦА СОБЫТИЯ» — вторая дверь развилки «Запись» (владелец 2026-09-08).
//
// Цвета у события своего правила нет и не заводится: его красит ТИП, и это
// сказано в самой форме строкой под лентой типов. Поэтому здесь ровно то, чем
// событие управляется на деле: справочник типов и состав формы.
//
// Блоки формы у записи и события ОДНИ (`useBookingBlocks`): бизнес, которому
// не нужен объект, не нужен он и в событии. Дверь стоит и здесь, чтобы за ней
// не приходилось идти в соседнюю страницу, но настройка одна — так и написано
// в подписи строки.

export default function BookingEventSettingsScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const base = pathname.includes("/calendar/") ? "/calendar" : "/cabinet";

  const typesQuery = usePersonalEventTypes();
  const all = typesQuery.data ?? [];
  const live = all.filter((type) => !type.hidden);
  const hidden = all.length - live.length;
  const typesDesc = typesQuery.isLoading
    ? "Загрузка…"
    : live.length === 0
      ? "Типов пока нет"
      : `${live.length} в форме${hidden > 0 ? `, ${hidden} скрыто` : ""}`;

  const blocks = useBookingBlocks();
  const blocksDesc =
    blocks.length === BOOKING_BLOCKS.length
      ? "Все блоки · общие с записью"
      : `${blocks.length} из ${BOOKING_BLOCKS.length} · общие с записью`;

  const open = (href: string) => {
    haptics.tap();
    router.push(href as Href);
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Событие" />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <SectionCard title="Форма события">
          {/* Тип называет событие, красит его в календаре и подсказывает
              длительность — весь смысл события живёт здесь. */}
          <SettingsRow
            tile={SETTINGS_TILE.purple}
            icon={Tags}
            title="Типы событий"
            sub={typesDesc}
            onPress={() => open(`${base}/event-types`)}
          />
          <Divider inset={58} />
          <SettingsRow
            tile={SETTINGS_TILE.blue}
            icon={LayoutList}
            title="Блоки формы"
            sub={blocksDesc}
            onPress={() => open(`${base}/booking-blocks`)}
          />
        </SectionCard>
      </ScrollView>
    </Screen>
  );
}
