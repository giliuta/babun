import { ScrollView } from "react-native";
import {
  DEFAULT_CALENDAR_SETTINGS,
  type CalendarSettings,
} from "@babun/shared/local/calendar-settings";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { EmptyState } from "@/components/ui/EmptyState";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { notify } from "@/lib/notify";
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
      onError: (e) => notify("Ошибка", e.message),
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
        </SectionCard>
        {/* Тумблера «разрешать заканчивать позже» здесь нет намеренно: поле
            allowOvertime не читает НИКТО, и переключатель был бы обманом —
            человек его двигает, а календарь ведёт себя одинаково. Запись и так
            может выходить за конец дня: календарь предупреждает, но не мешает. */}

        <SectionEyebrow>Деньги</SectionEyebrow>
        <SectionCard>
          <SwitchRow
            label="Доход и расход под сеткой"
            hint="Полоса по дням: сверху доход, снизу расход. Тап по дню открывает разбор"
            value={s.showDayFinance !== false}
            onChange={(v) => patch({ showDayFinance: v })}
          />
        </SectionCard>

      </ScrollView>
    </Screen>
  );
}
