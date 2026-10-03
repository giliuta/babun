import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, type Href } from "expo-router";
import { RotateCcw, Trash2 } from "lucide-react-native";
import { isOnline } from "@babun/shared/sync";
import { SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { EmptyState } from "@/components/ui/EmptyState";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SELECT_SIDE } from "@/components/ui/select-rows";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { useToast } from "@/components/ui/Toast";
import { confirmThen } from "@/lib/confirm";
import { useThemeColors } from "@/theme/colors";
import { humanDayYear } from "@/features/appointments/helpers";
import { daysLeft, daysWordRu } from "@/features/clients/HiddenClientsScreen";
import { useClients } from "@/features/clients/queries";
import { useMasters, useTeams } from "@/features/reference/queries";
import { useAccountsWithBalances } from "./accounts";
import { sortAccountRows } from "./accounts-sections";
import {
  useDeletedOperations,
  useEraseDeletedOperation,
  useRestoreOperation,
} from "./deleted-operations";
import { useFinanceCategories } from "./queries";
import { RecordRowView, type RecordRowTone } from "./RecordRow";
import { recordRows, type RecordRow } from "./record-rows";

// «УДАЛЁННЫЕ ОПЕРАЦИИ» — КАК «УДАЛЁННЫЕ СЧЕТА» И «УДАЛЁННЫЕ КЛИЕНТЫ»
// (владелец 03.10: «удалённые операции добавляем — это отлично»). Дверь —
// шестерёнка «Финансов», блок «Деньги»; страница — выбранной там команды.
//
// Строка — та же плашка, что в ленте «Финансов» (`RecordRowView`): что за
// операция, сумма её цветом и под суммой — сколько дней ей осталось. Дни —
// заголовками по дате самой операции, как в ленте. Левая кромка — «Вернуть»:
// операция снова в ленте и в остатке счёта. Правая — «Удалить» насовсем.
// Тап открывает те же два действия словами: кто не свайпает, не упирается в
// мёртвый список.
//
// Права (AGENTS 10): строка шестерёнки «Удалённые операции» (`settings-levels`,
// дверь `FinanceSettingsRoute`). Сервер держит ящик своей RLS: владелец —
// всё; партнёр с «Только видит» — ящик команды в тех деньгах, что видит сам,
// с «Возвращает» — возвращает и стирает своё (миграция 20261003235500).

interface TrashRow {
  id: string;
  row: RecordRow;
  tone: RecordRowTone;
}

const OFFLINE = "Без сети не получится — операции живут на сервере.";

export function DeletedOperationsScreen() {
  const t = useThemeColors();
  const toast = useToast();
  const { team } = useLocalSearchParams<{ team?: string }>();
  const teamName = (useTeams().data ?? []).find((item) => item.id === team)?.name;
  const deleted = useDeletedOperations();
  const restore = useRestoreOperation();
  const erase = useEraseDeletedOperation();
  const [menu, setMenu] = useState<TrashRow | null>(null);

  // Справочники — чтобы строка назвала категорию, клиента, получателя и
  // счёт. Счета — со скрытыми и удалёнными: операция могла пройти через счёт,
  // которого в живом списке уже нет, а имя у неё осталось.
  const categories = useFinanceCategories().data;
  const clients = useClients().data;
  const people = useMasters({ includeInactive: true }).data;
  const accounts = useAccountsWithBalances({
    includeInactive: true,
    includeDeleted: true,
    includeHidden: true,
  }).data;

  const rows = useMemo<TrashRow[]>(() => {
    const refs = {
      appointments: [],
      clients: clients ?? [],
      services: [],
      categories: categories ?? [],
      accounts: sortAccountRows(accounts ?? []),
      people: people ?? [],
    };
    return (deleted.data ?? [])
      .filter((item) => !team || item.teamId === team)
      .flatMap((item) => {
        // По одной: склейка визита и пары перевода ящику не нужна — каждая
        // строка возвращается сама.
        const [row] = recordRows([item.transaction], refs);
        if (!row) return [];
        const left = daysLeft(item.purgeAt);
        const tx = item.transaction;
        return [
          {
            id: item.id,
            tone: tx.debt_id ? "debt" : tx.type === "expense" ? "expense" : "income",
            row: {
              ...row,
              key: item.id,
              caption:
                left === null ? undefined : left <= 0 ? "сегодня" : `${left} ${daysWordRu(left)}`,
            },
          } satisfies TrashRow,
        ];
      })
      .sort((a, b) => (a.row.date < b.row.date ? 1 : a.row.date > b.row.date ? -1 : 0));
  }, [deleted.data, team, categories, clients, people, accounts]);

  const days = useMemo(() => {
    const byDay = new Map<string, TrashRow[]>();
    for (const item of rows) {
      const day = byDay.get(item.row.date);
      if (day) day.push(item);
      else byDay.set(item.row.date, [item]);
    }
    return [...byDay.entries()];
  }, [rows]);

  const giveBack = (item: TrashRow) =>
    restore.mutate(item.id, {
      onSuccess: () => toast("Операция возвращена"),
      onError: (e) => toast(isOnline() ? e.message : OFFLINE, "error"),
    });

  const eraseForever = (item: TrashRow) =>
    confirmThen(
      "Удалить насовсем?",
      { message: "Операцию уже не вернуть.", confirmLabel: "Удалить", destructive: true },
      () =>
        erase.mutateAsync(item.id).then(
          () => toast("Операция удалена насовсем"),
          (e: unknown) =>
            toast(isOnline() ? (e instanceof Error ? e.message : String(e)) : OFFLINE, "error"),
        ),
    );

  return (
    <Screen>
      <ScreenHeader
        title="Удалённые операции"
        subtitle={teamName}
        fallbackHref={
          (team ? `/finances/settings?team=${encodeURIComponent(team)}` : "/finances/settings") as Href
        }
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
        <EmptyState fill title="Пусто" />
      ) : (
        <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
          {days.map(([day, items]) => (
            <View key={day}>
              {/* День — подписью над плашками, как в ленте «Финансов». */}
              <Text
                className="px-4 pb-1.5 pt-3 text-xs font-semibold uppercase tracking-wider"
                style={{ color: t.sub }}
              >
                {humanDayYear(day)}
              </Text>
              <View style={{ paddingHorizontal: SELECT_SIDE, gap: 8 }}>
                {items.map((item) => (
                  <SwipeRow
                    key={item.id}
                    radius={t.radius.input}
                    leading={{
                      label: "Вернуть",
                      color: t.success,
                      icon: RotateCcw,
                      accessibilityLabel: `Вернуть операцию ${item.row.title}`,
                      onAction: () => giveBack(item),
                    }}
                    label="Удалить"
                    color={t.danger}
                    icon={Trash2}
                    accessibilityLabel={`Удалить операцию ${item.row.title} насовсем`}
                    onAction={() => eraseForever(item)}
                  >
                    <RecordRowView row={item.row} tone={item.tone} onPress={() => setMenu(item)} />
                  </SwipeRow>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
      <PickerSheet
        visible={menu !== null}
        title={menu?.row.title ?? "Операция"}
        items={
          menu
            ? [
                {
                  id: "restore",
                  label: "Вернуть",
                  icon: RotateCcw,
                  color: t.success,
                  onPress: () => {
                    const item = menu;
                    setMenu(null);
                    giveBack(item);
                  },
                },
                {
                  id: "erase",
                  label: "Удалить насовсем",
                  icon: Trash2,
                  color: t.danger,
                  onPress: () => {
                    const item = menu;
                    setMenu(null);
                    // Вопрос — после отъезда меню: поверх уезжающего листа
                    // iOS окно не покажет.
                    setTimeout(() => eraseForever(item), SHEET_EXIT_MS + 350);
                  },
                },
              ]
            : []
        }
        onClose={() => setMenu(null)}
      />
    </Screen>
  );
}
