import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, type Href } from "expo-router";
import { CalendarClock, CalendarDays, RotateCcw, Trash2 } from "lucide-react-native";
import { isOnline } from "@babun/shared/sync";
import type { DeletedAppointment } from "@babun/shared/db/repositories/deleted-appointments";
import { SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { EmptyState } from "@/components/ui/EmptyState";
import { PickerSheet, type PickerSheetItem } from "@/components/ui/PickerSheet";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SELECT_SIDE, SelectRow } from "@/components/ui/select-rows";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { useToast } from "@/components/ui/Toast";
import { confirmThen } from "@/lib/confirm";
import { useThemeColors } from "@/theme/colors";
import { useSession } from "@/providers/SessionProvider";
import { daysLeft, daysWordRu } from "@/features/clients/HiddenClientsScreen";
import { todayYMD } from "@/features/clients/filter";
import { useClients } from "@/features/clients/queries";
import { useRecordColor } from "@/features/clients/use-record-color";
import { VisitDayHeader } from "@/features/clients/VisitRow";
import { useTeams } from "@/features/reference/queries";
import { serverReason } from "./server-reason";
import { recordComment } from "./record-title";
import { canRestoreDeleted } from "./deleted-appointments-lines";
import {
  useDeletedAppointments,
  useEraseDeletedAppointment,
  useRestoreAppointment,
} from "./deleted-appointments";

// «УДАЛЁННЫЕ ЗАПИСИ» — КАК «УДАЛЁННЫЕ ОПЕРАЦИИ». Дверь — шестерёнка
// календаря; страница — выбранного там календаря (`?team=`).
//
// Строка — та же плашка, что у записи в истории клиента (`SelectRow`, плитка
// цветом записи, день — заголовком над плашками): кто и когда, справа —
// сколько дней ей осталось. Левая кромка — «Вернуть»: запись снова в
// календаре вместе с фото. Правая — «Удалить» насовсем. Тап открывает те же
// два действия словами: кто не свайпает, не упирается в мёртвый список.
//
// Права (AGENTS 10): закрыта правом удалять в этом календаре — у сотрудника
// блоки «Отменять и удалять» (`calendar.cancel`) и «События» на «Меняет».
// Сервер держит ящик своей RLS: владелец — всё; остальные — то, что удалили
// сами, пока право удалять в этом календаре у них есть. Событие возвращает
// только автор — у чужого события левой кромки нет.

const OFFLINE = "Без сети не получится — удалённые записи живут на сервере.";

interface TrashRow {
  item: DeletedAppointment;
  title: string;
  subtitle: string;
  caption: string | undefined;
}

export function DeletedAppointmentsScreen() {
  const t = useThemeColors();
  const toast = useToast();
  const { team } = useLocalSearchParams<{ team?: string }>();
  const teams = useTeams({ includeInactive: true }).data ?? [];
  const teamRow = teams.find((item) => item.id === team);
  const me = useSession().session?.user.id ?? null;
  const deleted = useDeletedAppointments();
  const restore = useRestoreAppointment();
  const erase = useEraseDeletedAppointment();
  const clients = useClients().data;
  const [menu, setMenu] = useState<TrashRow | null>(null);
  const today = todayYMD();

  const rows = useMemo<TrashRow[]>(() => {
    const names = new Map((clients ?? []).map((c) => [c.id, c.full_name] as const));
    return (deleted.data ?? [])
      .filter((item) => !team || item.teamId === team)
      .map((item) => {
        const a = item.appointment;
        const event = item.kind !== "work";
        const repeating = !!a.event_repeat && a.event_repeat.kind !== "none";
        const who = a.client_id ? names.get(a.client_id) : undefined;
        // Имя события — как на сетке (`recordComment`): тип, иначе первая
        // строка заметки; голое «Событие» ничего не говорит.
        const title = (event ? recordComment(a) : who || a.comment)?.trim() || (event ? "Событие" : "Запись");
        const time = a.event_all_day
          ? "Весь день"
          : [a.time_start?.slice(0, 5), a.time_end?.slice(0, 5)].filter(Boolean).join("–");
        const left = daysLeft(item.purgeAt);
        return {
          item,
          title,
          subtitle: repeating ? `${time} · повторяется` : time,
          caption: left === null ? undefined : left <= 0 ? "сегодня" : `${left} ${daysWordRu(left)}`,
        };
      })
      .sort((x, y) =>
        x.item.appointment.date < y.item.appointment.date
          ? 1
          : x.item.appointment.date > y.item.appointment.date
            ? -1
            : 0,
      );
  }, [deleted.data, team, clients]);

  const days = useMemo(() => {
    const byDay = new Map<string, TrashRow[]>();
    for (const row of rows) {
      const day = byDay.get(row.item.appointment.date);
      if (day) day.push(row);
      else byDay.set(row.item.appointment.date, [row]);
    }
    return [...byDay.entries()];
  }, [rows]);

  const failed = (e: unknown, fallback: string) =>
    toast(isOnline() ? (serverReason(e) ?? fallback) : OFFLINE, "error");

  const giveBack = (row: TrashRow) =>
    restore.mutate(row.item.id, {
      onSuccess: () => toast(row.item.kind === "work" ? "Запись возвращена" : "Событие возвращено"),
      onError: (e) => failed(e, "Не удалось вернуть"),
    });

  const eraseForever = (row: TrashRow) =>
    confirmThen(
      "Удалить насовсем?",
      {
        // У события своё слово: «запись» у события путает (в ящике лежат
        // оба вида).
        message: row.item.kind === "work" ? "Запись и её фото уже не вернуть." : "Действие необратимо.",
        confirmLabel: "Удалить",
        destructive: true,
      },
      () =>
        erase.mutateAsync(row.item).then(
          () => toast("Удалено насовсем"),
          (e: unknown) => failed(e, "Не удалось удалить"),
        ),
    );

  const menuItems = (row: TrashRow): PickerSheetItem[] => [
    ...(canRestoreDeleted(row.item, me)
      ? [
          {
            id: "restore",
            label: "Вернуть",
            icon: RotateCcw,
            color: t.success,
            onPress: () => {
              setMenu(null);
              giveBack(row);
            },
          },
        ]
      : []),
    {
      id: "erase",
      label: "Удалить насовсем",
      icon: Trash2,
      color: t.danger,
      onPress: () => {
        setMenu(null);
        // Вопрос — после отъезда меню: поверх уезжающего листа iOS окно не
        // покажет.
        setTimeout(() => eraseForever(row), SHEET_EXIT_MS + 350);
      },
    },
  ];

  return (
    <Screen>
      <ScreenHeader
        title="Удалённые записи"
        subtitle={teamRow?.name}
        fallbackHref={(team ? `/calendar?team=${encodeURIComponent(team)}` : "/calendar") as Href}
      />
      {deleted.data === undefined ? (
        deleted.error ? (
          <EmptyState
            state="error"
            fill
            title="Нет связи с сервером"
            subtitle={deleted.error.message}
            action={{ label: "Повторить", onPress: () => void deleted.refetch() }}
          />
        ) : (
          <EmptyState state="loading" fill />
        )
      ) : rows.length === 0 ? (
        <EmptyState fill title="Удалённых записей нет" />
      ) : (
        <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
          {days.map(([day, items]) => (
            <View key={day}>
              <VisitDayHeader date={day} />
              <View style={{ paddingHorizontal: SELECT_SIDE, gap: 8 }}>
                {items.map((row) => (
                  <SwipeRow
                    key={row.item.id}
                    radius={t.radius.input}
                    leading={
                      canRestoreDeleted(row.item, me)
                        ? {
                            label: "Вернуть",
                            color: t.success,
                            icon: RotateCcw,
                            accessibilityLabel: `Вернуть ${row.title}`,
                            onAction: () => giveBack(row),
                          }
                        : undefined
                    }
                    label="Удалить"
                    color={t.danger}
                    icon={Trash2}
                    accessibilityLabel={`Удалить ${row.title} насовсем`}
                    onAction={() => eraseForever(row)}
                  >
                    <DeletedRow
                      row={row}
                      teamColor={teams.find((x) => x.id === row.item.teamId)?.color}
                      today={today}
                      onPress={() => setMenu(row)}
                    />
                  </SwipeRow>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
      <PickerSheet
        visible={menu !== null}
        title={menu?.title ?? "Запись"}
        items={menu ? menuItems(menu) : []}
        onClose={() => setMenu(null)}
      />
    </Screen>
  );
}

/** Плашка записи из ящика: плитка цветом записи (как блок в календаре),
 *  кто — названием, время — подписью, справа — сколько дней осталось. */
function DeletedRow({
  row,
  teamColor,
  today,
  onPress,
}: {
  row: TrashRow;
  teamColor: string | null | undefined;
  today: string;
  onPress: () => void;
}) {
  const t = useThemeColors();
  const hue = useRecordColor(row.item.appointment, teamColor, today) || t.accent;
  return (
    <SelectRow
      icon={row.item.kind === "work" ? CalendarClock : CalendarDays}
      color={hue}
      plain
      title={row.title}
      subtitle={row.subtitle || undefined}
      accessibilityLabel={[row.title, row.subtitle, row.caption].filter(Boolean).join(", ")}
      onPress={onPress}
      trailing={
        row.caption ? (
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: t.sub }}>
            {row.caption}
          </Text>
        ) : undefined
      }
    />
  );
}
