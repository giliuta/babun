import { Alert, ScrollView } from "react-native";
import {
  DEFAULT_CALENDAR_SETTINGS,
  type CalendarSettings,
} from "@babun/shared/local/calendar-settings";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SectionFooter } from "@/components/ui/SectionFooter";
import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import { SwitchRow } from "@/components/ui/SwitchRow";
import {
  useCalendarSettings,
  useSaveCalendarSettings,
} from "@/features/settings/local-settings";

// ЧТО ПОКАЗЫВАТЬ В КАЛЕНДАРЕ.
//
// Тот же приём, что у клиентов («Что показывать на карточке»): переключатели
// вида собраны на своей странице, а в настройках стоит одна строка с текущим
// ответом. Иначе главный экран настроек превращается в простыню тумблеров,
// среди которых не найти рабочие часы.

export default function CalendarDisplayScreen() {
  const settingsQuery = useCalendarSettings();
  const settings = settingsQuery.data;
  const save = useSaveCalendarSettings();

  if (settingsQuery.isLoading) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Что показывать" />
        <EmptyState state="loading" fill />
      </Screen>
    );
  }

  const s: CalendarSettings = settings ?? DEFAULT_CALENDAR_SETTINGS;
  // Instant-commit, как во всех настройках календаря: кнопки «Сохранить» нет.
  const patch = (p: Partial<CalendarSettings>) => {
    if (!settings) return;
    save.mutate(p, {
      onError: (e) => Alert.alert("Ошибка", e.message),
    });
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Что показывать" />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
        <SectionEyebrow>Записи</SectionEyebrow>
        <SectionCard>
          <SwitchRow
            label="Скрывать отменённые"
            hint="Отменённая запись исчезает из сетки, но остаётся в истории клиента"
            value={!!s.hideCancelled}
            onChange={(v) => patch({ hideCancelled: v })}
          />
          <Divider inset={16} />
          <SwitchRow
            label="Разрешать заканчивать позже"
            hint="Запись может выходить за конец рабочего дня — календарь не мешает"
            value={!!s.allowOvertime}
            onChange={(v) => patch({ allowOvertime: v })}
          />
        </SectionCard>
        <SectionFooter>
          Настройка про ВИД, а не про данные: скрытая запись никуда не девается —
          она есть в истории клиента и в деньгах.
        </SectionFooter>

        <SectionEyebrow>Неделя</SectionEyebrow>
        <SectionCard>
          <SwitchRow
            label="Неделя начинается с воскресенья"
            hint="Выключено — неделя начинается с понедельника"
            value={s.weekStart === "sunday"}
            onChange={(v) => patch({ weekStart: v ? "sunday" : "monday" })}
          />
        </SectionCard>
      </ScrollView>
    </Screen>
  );
}
