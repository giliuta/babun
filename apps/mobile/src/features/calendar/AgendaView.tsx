import {
  FlatList,
  RefreshControl,
  View,
} from "react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { EmptyState } from "@/components/ui/EmptyState";
import { useThemeColors } from "@/theme/colors";
import { DaySection } from "./agenda/DaySection";
import { headerRu } from "./agenda/header-ru";
import type { AgendaSection } from "./agenda/types";
import { useScrollToToday } from "./agenda/use-scroll-to-today";

// Agenda («Список») — web AgendaView parity: chronological feed of upcoming
// visits grouped into per-day cards. Day/Week/Month answer «what does today
// look like?»; Agenda answers «what's next on my plate» — dispatchers plan
// routes off it, hence the per-day «Маршрут дня →» maps deep-link.
// Parts live in `agenda/`: the day card, the rows, the route link and the
// month's first scroll to today.

export type { AgendaSection } from "./agenda/types";

export function AgendaView({
  sections,
  todayYmd,
  tomorrowYmd,
  clientName,
  serviceSummary,
  onEdit,
  onMenu,
  labelFor,
  offLabelFor,
  hueFor,
  situationFor,
  overdueFor,
  showAmounts = true,
  addressFor,
  refreshing,
  onRefresh,
  onCreate,
}: {
  sections: AgendaSection[];
  /** Business-timezone anchors for the «Сегодня»/«Завтра» headers. */
  todayYmd: string;
  tomorrowYmd: string;
  clientName: (a: Appointment) => string;
  serviceSummary: (a: Appointment) => string;
  onEdit: (a: Appointment) => void;
  /** Long-press контекстное меню записи — как в Day/Week. */
  onMenu?: (a: Appointment) => void;
  /** Метка дня (город) — чип в заголовке дня: единая система дат со
   *  шапками Дня/Недели и точками Месяца. */
  labelFor?: (dateYmd: string) => { name: string; color: string } | null;
  /** Метка САМОЙ записи, когда она отличается от метки дня
   *  (`resolveOffDayLabel`). В списке для неё есть место, поэтому она
   *  называется словом, а не только цветом, как в сетке. */
  offLabelFor?: (a: Appointment) => { name: string; color: string } | null;
  /** Цвет записи и её ситуация — те же, что в сетке (`record-color`). */
  hueFor?: (a: Appointment) => string;
  situationFor?: (a: Appointment) => string | null;
  /** Работа не закрыта: время прошло, статус остался «запланирована».
   *  В сетке это кант вдвое толще — канал СРАВНИТЕЛЬНЫЙ, и на сплошь
   *  просроченной прошлой неделе он однороден. Слово живёт здесь: лента
   *  служит сетке легендой, как уже служит для ситуаций. */
  overdueFor?: (a: Appointment) => boolean;
  /** Суммы в строках. Сотруднику — по его праву «Сумма» в календаре записи
   *  (не целиком по роли: сервер отдаёт суммы тем, у кого «Сумма» не скрыта). */
  showAmounts?: boolean | ((a: Appointment) => boolean);
  /** Куда ехать — то же правило, что у блока сетки и «Маршрута» в меню:
   *  снимок адреса записи, иначе адрес клиента. */
  addressFor?: (a: Appointment) => string | null;
  refreshing: boolean;
  onRefresh: () => void;
  /** Пустая лента — «Новая запись» внизу (пустое состояние не должно быть
   *  тупиком). Кому
   *  создавать нельзя — не передаётся. */
  onCreate?: () => void;
}) {
  const t = useThemeColors();
  const listRef = useScrollToToday(sections, todayYmd);
  // ПУСТОЙ МЕСЯЦ — ЭКРАН, А НЕ СТРОКА ЛЕНТЫ. Внутри ленты пустое состояние
  // наследует её отступы — 16 сверху и 96 снизу, — и «Новая запись» встаёт
  // выше своего места. Снаружи ленты кнопка стоит там же, где футер у всех
  // экранов. Слова — одни: месяц уже назван в шапке, а «ближайшие 60 дней» и
  // «последняя была …» не нужны.
  if (sections.length === 0) {
    return (
      <EmptyState
        fill
        title="Записей нет"
        action={
          onCreate ? { label: "Создать запись", onPress: onCreate } : undefined
        }
      />
    );
  }
  return (
    <View style={{ flex: 1 }}>
      <FlatList
        ref={listRef}
        style={{ flex: 1 }}
        data={sections}
        // Высоты дней разные, и до дальнего дня лента ещё не измерена:
        // сначала прыжок по средней высоте, потом точно.
        onScrollToIndexFailed={(info) => {
          listRef.current?.scrollToOffset({
            offset: info.averageItemLength * info.index,
            animated: false,
          });
          setTimeout(
            () => listRef.current?.scrollToIndex({ index: info.index, animated: false }),
            60,
          );
        }}
        keyExtractor={(s) => s.title}
        contentContainerStyle={{
          padding: 16,
          paddingBottom: 96,
          gap: 16,
          flexGrow: 1,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={t.accent}
          />
        }
        renderItem={({ item }) => {
          const label = labelFor?.(item.title) ?? null;
          return (
            <DaySection
              section={item}
              header={headerRu(item.title, todayYmd, tomorrowYmd)}
              label={label}
              offLabelFor={offLabelFor}
              hueFor={hueFor}
              situationFor={situationFor}
              overdueFor={overdueFor}
              clientName={clientName}
              serviceSummary={serviceSummary}
              onEdit={onEdit}
              onMenu={onMenu}
              showAmounts={showAmounts}
              addressFor={addressFor}
              t={t}
            />
          );
        }}
      />
      {/* «СПИСОК» — ДЛЯ ПРОСМОТРА. Постоянной кнопки
          создания нет; только у пустой ленты — «Новая запись» внизу. */}
    </View>
  );
}
