import { ScrollView } from "react-native";
import { usePathname, useRouter, type Href } from "expo-router";
import { CalendarCheck, CalendarClock } from "lucide-react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { Divider } from "@/components/ui/Divider";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { haptics } from "@/lib/haptics";
import {
  AUTO_COLOR_RULES,
  BOOKING_BLOCKS,
  useAutoColorRule,
  useBookingBlocks,
} from "@/features/appointments/booking-prefs";
import { usePersonalEventTypes } from "@/features/settings/local-settings";

// «ЗАПИСЬ» — РАЗВИЛКА НА ДВЕ ФОРМЫ (владелец 2026-09-08: «перехожу в записи и
// там сразу выбираю, что буду редактировать: страницу записи или страницу
// события; нажимаю — открывается всё по ним»).
//
// Календарь заводит ДВЕ вещи одной страницей `/book`: запись и событие. Их
// настройки жили в разных концах Кабинета — цвет и блоки записи здесь, типы
// событий отдельной строкой в списке справочников, — и связь между «формой
// записи» и «формой события» на экране не читалась никак.
//
// Развилка стоит перед настройками, а не после: человек приходит сюда с уже
// готовым вопросом («хочу поправить событие»), и первый экран обязан этот
// вопрос принять, а не заставить читать чужие настройки.

export default function BookingSettingsHubScreen() {
  const router = useRouter();
  // Обе двери остаются в ТОМ стеке, где их открыли: страница живёт под двумя
  // адресами — /cabinet/booking и /calendar/booking, — и жёсткий push в
  // Кабинет уводил бы человека из календаря посреди настройки.
  const pathname = usePathname();
  const base = pathname.includes("/calendar/") ? "/calendar" : "/cabinet";

  const blocks = useBookingBlocks();
  const rule = useAutoColorRule();
  const recordDesc = [
    AUTO_COLOR_RULES.find((r) => r.id === rule)?.label ?? "Цвет команды",
    blocks.length === BOOKING_BLOCKS.length
      ? "все блоки"
      : `${blocks.length} из ${BOOKING_BLOCKS.length} блоков`,
  ].join(" · ");

  const typesQuery = usePersonalEventTypes();
  const live = (typesQuery.data ?? []).filter((type) => !type.hidden);
  const eventDesc = typesQuery.isLoading
    ? "Загрузка…"
    : live.length === 0
      ? "Типов пока нет"
      : live
          .slice(0, 3)
          .map((type) => type.label)
          .join(", ") + (live.length > 3 ? "…" : "");

  const open = (href: string) => {
    haptics.tap();
    router.push(href as Href);
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Запись" />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <SectionCard title="Что настраиваем">
          <SettingsRow
            tile={SETTINGS_TILE.blue}
            icon={CalendarCheck}
            title="Страница записи"
            sub={recordDesc}
            onPress={() => open(`${base}/booking-record`)}
          />
          <Divider inset={58} />
          <SettingsRow
            tile={SETTINGS_TILE.purple}
            icon={CalendarClock}
            title="Страница события"
            sub={eventDesc}
            onPress={() => open(`${base}/booking-event`)}
          />
        </SectionCard>
      </ScrollView>
    </Screen>
  );
}
