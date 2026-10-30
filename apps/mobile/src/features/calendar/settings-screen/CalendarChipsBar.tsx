import { Pressable, Text } from "react-native";
import { FOREIGN_PREFIX, calendarOrderKey } from "@/session/calendar-chips";
import { ScopeChips } from "@/components/ui/ScopeChips";
import { useThemeColors } from "@/theme/colors";
import { notify } from "@/lib/notify";
import type { CalendarSettingsState } from "./use-calendar-settings-screen";

/** The calendars ribbon on top of the settings, with «Добавить» pinned right. */
export function CalendarChipsBar({ screen }: { screen: CalendarSettingsState }) {
  const t = useThemeColors();
  const { router, gearChips, team, rows, setCreateOpen, saveCalendarOrder, tenantId } =
    screen;
  return (
    <ScopeChips
      items={gearChips.items}
      activeId={gearChips.pendingId ?? team?.id ?? null}
      // СОЗДАНИЕ ЖИВЁТ В ЛЕНТЕ КАЛЕНДАРЕЙ, СПРАВА. Отдельной строкой ниже оно стояло бы среди НАСТРОЕК
      // выбранного календаря — то есть в списке свойств одного объекта
      // лежало бы действие, создающее другой.
      //
      // ПРИКОЛОТА, А НЕ ВЛОЖЕНА В ЛЕНТУ: при трёх календарях со средними
      // именами лента длиннее экрана, а автоскролл подводит её к выбранному
      // чипу — вложенная кнопка пряталась бы ровно у того, кому она нужнее.
      //
      // ТЕКСТОМ, БЕЗ «+»: канон — «действия создания всегда подписаны
      // текстом», и это стережёт контрактный тест (импорт Plus из lucide
      // запрещён). Слово «календарь» в подписи лишнее: лента и так из них.
      // Заводит календари владелец: у того, кому настройки не открыты,
      // лента остаётся лентой его календарей, без действия.
      trailing={rows.addCalendar ? (
        <Pressable
          // Календари числом не ограничены: новый бесплатен, пока в нём
          // нет работы, а клиенты и записи в нём — после его оплаты.
          onPress={() => setCreateOpen(true)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Добавить календарь"
          style={({ pressed }: { pressed: boolean }) => ({
            minHeight: 44,
            justifyContent: "center",
            opacity: pressed ? 0.5 : 1,
          })}
        >
          <Text
            maxFontSizeMultiplier={1.2}
            style={{ fontSize: 15, fontWeight: "600", color: t.accent }}
          >
            Добавить
          </Text>
        </Pressable>
      ) : undefined}
      // «Все календари разом» здесь нет: настройки правятся у КОНКРЕТНОЙ
      // команды, и лента другого выбора не предлагает.
      onSelect={(id) => (id.startsWith(FOREIGN_PREFIX) ? gearChips.pick(id) : router.setParams({ team: id }))}
      // ПОРЯДОК — ЗАЖАТЬ И ПЕРЕТАЩИТЬ (у каждого свой). Порядок — человека (`user_calendar_order`): по нему стоят
      // ленты календаря, финансов и эта.
      onReorder={(ids) =>
        saveCalendarOrder.mutate(
          ids
            .map((id) => calendarOrderKey(id, tenantId))
            .filter((key): key is string => key != null),
          { onError: (e) => notify("Не удалось сохранить порядок", e.message) },
        )
      }
    />
  );
}
