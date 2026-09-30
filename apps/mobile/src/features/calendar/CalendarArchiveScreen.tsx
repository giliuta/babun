import { useMemo, useState } from "react";
import { ScrollView } from "react-native";
import { ArchiveRestore, Trash2 } from "lucide-react-native";
import { money } from "@babun/shared/common/utils/money";
import { EmptyState } from "@/components/ui/EmptyState";
import { NavRow, RowCaption } from "@/components/ui/card-rows";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { useToast } from "@/components/ui/Toast";
import { useAccountsWithBalances } from "@/features/finances/accounts";
import { useTeams } from "@/features/reference/queries";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import {
  archivedCalendarCaption,
  archivedCalendars,
  type ArchivedCalendar,
} from "./calendar-archive";
import { eraseCalendarMessage } from "./calendar-delete";
import { useAppointments } from "./queries";
import { useCalendarDelete } from "./useCalendarDelete";

// КАБИНЕТ → «АРХИВ». Сюда уходит календарь по кнопке «Удалить» в своих
// настройках, и только отсюда его можно стереть насовсем (владелец
// 2026-09-21: «удаляешь — оно кидается в архив и в архиве хранится, потом
// можно удалить с архива… архив засунь в Кабинет»).
//
// Строка календаря говорит, что лежит вместе с ним: записи, счета и деньги
// на них. Тап открывает тот же канонический лист действий, что у архива
// клиентов: «Вернуть в ленту» и красное «Удалить навсегда». Кнопок в самом
// списке нет (владелец 15.09: «никаких кнопок внутри»).

export function CalendarArchiveScreen() {
  const t = useThemeColors();
  const toast = useToast();
  const teamsQuery = useTeams({ includeInactive: true });
  const appointmentsQuery = useAppointments();
  // Деньги архивных календарей в живых финансах не существуют — архив
  // единственное место, которое просит их явно.
  const accountsQuery = useAccountsWithBalances({
    includeInactive: true,
    includeArchivedCalendars: true,
  });
  const { restore, measure, erase } = useCalendarDelete();
  const [picked, setPicked] = useState<ArchivedCalendar | null>(null);
  // Лист уезжает с анимацией: держим последний календарь, пока он виден.
  const [shown, setShown] = useState<ArchivedCalendar | null>(null);

  const rows = useMemo(
    () =>
      archivedCalendars({
        teams: teamsQuery.data ?? [],
        appointments: appointmentsQuery.data ?? [],
        accounts: accountsQuery.data ?? [],
      }),
    [teamsQuery.data, appointmentsQuery.data, accountsQuery.data],
  );

  const open = (calendar: ArchivedCalendar) => {
    setShown(calendar);
    setPicked(calendar);
  };

  const bringBack = (calendar: ArchivedCalendar) =>
    restore.mutate(calendar.id, {
      onSuccess: () => toast(`«${calendar.name}» снова в ленте`, "success"),
      onError: (e) => notify("Ошибка", e.message),
    });

  const eraseForever = (calendar: ArchivedCalendar) =>
    measure(calendar.id, appointmentsQuery.data ?? [])
      .then((impact) =>
        confirmThen(
          `Удалить «${calendar.name}» навсегда?`,
          {
            message: eraseCalendarMessage(impact),
            confirmLabel: "Удалить навсегда",
            destructive: true,
          },
          () =>
            erase.mutate(calendar.id, {
              onSuccess: () => toast(`«${calendar.name}» удалён навсегда`, "success"),
              onError: (e) => notify("Ошибка", e.message),
            }),
        ),
      )
      .catch((e: unknown) =>
        notify("Ошибка", e instanceof Error ? e.message : "Не удалось посчитать, что удалится"),
      );

  const loading = teamsQuery.isPending || appointmentsQuery.isPending || accountsQuery.isPending;
  const error = teamsQuery.error ?? appointmentsQuery.error ?? accountsQuery.error;

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Архив" />

      {loading ? (
        <EmptyState state="loading" fill />
      ) : error ? (
        <EmptyState
          fill
          state="error"
          title="Не удалось открыть архив"
          subtitle={error instanceof Error ? error.message : undefined}
          action={{
            label: "Повторить",
            onPress: () => {
              void teamsQuery.refetch();
              void appointmentsQuery.refetch();
              void accountsQuery.refetch();
            },
          }}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          fill
          title="Архив пуст"
          subtitle="Сюда попадают удалённые календари. Отсюда их можно вернуть или удалить навсегда."
        />
      ) : (
        <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
          <SectionEyebrow>Календари</SectionEyebrow>
          <SectionCard>
            {rows.map((calendar, index) => (
              <NavRow
                key={calendar.id}
                separated={index > 0}
                label={calendar.name}
                value={archivedCalendarCaption(calendar, (amount) => money(amount))}
                onPress={() => open(calendar)}
              />
            ))}
          </SectionCard>
          <RowCaption text="Записи этих календарей видны в карточках клиентов. Вернуть календарь или удалить навсегда — нажатием на него." />
        </ScrollView>
      )}

      <PickerSheet
        visible={picked !== null}
        title={shown?.name ?? "Календарь"}
        items={
          shown
            ? [
                {
                  id: "restore",
                  label: "Вернуть в ленту",
                  icon: ArchiveRestore,
                  color: t.accent,
                  onPress: () => {
                    setPicked(null);
                    bringBack(shown);
                  },
                },
                {
                  id: "erase",
                  label: "Удалить навсегда",
                  icon: Trash2,
                  color: t.danger,
                  onPress: () => {
                    setPicked(null);
                    void eraseForever(shown);
                  },
                },
              ]
            : []
        }
        onClose={() => setPicked(null)}
      />
    </Screen>
  );
}
