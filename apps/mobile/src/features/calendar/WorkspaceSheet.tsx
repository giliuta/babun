import { useState } from "react";
import { View } from "react-native";
import { CalendarDays } from "lucide-react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Spinner } from "@/components/ui/Spinner";
import { SelectList, SelectRow } from "@/components/ui/select-rows";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { haptics } from "@/lib/haptics";
import {
  useMyCalendars,
  useSwitchWorkspace,
  type MyCalendar,
} from "@/features/settings/workspaces";

// ВСЕ МОИ КАЛЕНДАРИ В ОДНОМ СПИСКЕ — И СВОИ, И ЧУЖИХ КОМПАНИЙ.
//
// Владелец 2026-09-12: «устроился к кому-то на работу — ему добавляют
// календарь компании, и у него два календаря: свой и рабочий».
//
// Человек думает КАЛЕНДАРЯМИ, а не «контурами»: для него это один список, где
// рядом стоят личный и рабочий. Поэтому граница компаний здесь не стена, а
// вторая строка: под именем календаря написано, чей он. Переключение контура —
// наша внутренняя работа, и она не должна быть видна как отдельный шаг.
//
// ЧТО ПРОИСХОДИТ ПО ТАПУ:
//   • календарь активной компании — просто выбирается, ничего не переключаем;
//   • календарь другой компании — `switchTenant`: пауза синхронизации, чистка
//     кэша старой компании, смена активной компании в токене, сверка, вторая
//     чистка. Это занимает секунду-другую, поэтому строка показывает работу и
//     лист не закрывается, пока не закончено: молчаливая пауза выглядит как
//     «не нажалось», и человек жмёт второй раз.
//
// ФУТЕРА НЕТ: одиночный выбор закрывает лист сам (канон 5.2). Кнопки «Создать
// календарь» здесь тоже нет — она живёт в настройках календаря, и второй
// двери к одному действию не бывает.

export function WorkspaceSheet({
  visible,
  activeTeamId,
  onClose,
  onPick,
}: {
  visible: boolean;
  /** Календарь, открытый сейчас, — для галки в списке. */
  activeTeamId: string | null;
  onClose: () => void;
  /** Зовётся ПОСЛЕ того, как контур уже переключён: экран календаря ставит
   *  выбранный календарь активным и запоминает выбор. */
  onPick: (teamId: string) => void;
}) {
  const toast = useToast();
  const { data: calendars = [], isLoading } = useMyCalendars();
  const switching = useSwitchWorkspace();
  const [busyTeamId, setBusyTeamId] = useState<string | null>(null);

  const pick = async (calendar: MyCalendar) => {
    if (busyTeamId) return;
    haptics.tap();

    if (calendar.isActive) {
      onPick(calendar.teamId);
      onClose();
      return;
    }

    setBusyTeamId(calendar.teamId);
    try {
      await switching.mutateAsync(calendar.tenantId);
      onPick(calendar.teamId);
      onClose();
    } catch (error) {
      // Переключение не состоялось — человек остаётся там, где был, и знает
      // почему. Лист НЕ закрываем: закрытый лист после ошибки читается как
      // «получилось».
      toast(
        error instanceof Error ? error.message : "Не удалось переключиться",
        "error",
      );
    } finally {
      setBusyTeamId(null);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Календари">
      {isLoading ? (
        <View style={{ paddingVertical: 24, alignItems: "center" }}>
          {/* Крутилка продукта, а не системная: серый системный индикатор
              вне палитры и в части случаев iOS рисует его СТОЯЩИМ —
              «как будто зависло» (канон, контрактный тест ui-policy). */}
          <Spinner />
        </View>
      ) : calendars.length === 0 ? (
        <EmptyState
          title="Календарей пока нет"
          subtitle="Здесь появятся ваши календари и те, куда вас добавили."
        />
      ) : (
        <SelectList>
          {calendars.map((calendar) => (
            <SelectRow
              key={`${calendar.tenantId}:${calendar.teamId}`}
              title={calendar.teamName}
              subtitle={calendar.tenantName}
              // Третья строка говорит вслух, что человек там может. Календарь,
              // куда пустили только смотреть, не должен выглядеть так же, как
              // свой собственный.
              hint={hintFor(calendar)}
              icon={CalendarDays}
              color={calendar.teamColor ?? undefined}
              selected={calendar.isActive && calendar.teamId === activeTeamId}
              disabled={!!busyTeamId && busyTeamId !== calendar.teamId}
              trailing={
                busyTeamId === calendar.teamId ? <Spinner /> : undefined
              }
              accessibilityRole="radio"
              accessibilityLabel={`${calendar.teamName}, ${calendar.tenantName}`}
              onPress={() => void pick(calendar)}
            />
          ))}
        </SelectList>
      )}
    </BottomSheet>
  );
}

function hintFor(calendar: MyCalendar): string | undefined {
  if (calendar.role === "owner") return undefined;
  if (calendar.grants.includes("book")) return "Работа в этом календаре";
  if (calendar.grants.includes("view")) return "Только просмотр";
  return "Доступ ограничен";
}
