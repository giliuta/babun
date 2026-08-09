import { useMemo, useState, type ReactNode } from "react";
import type React from "react";
import { Alert, FlatList, RefreshControl, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { UseQueryResult } from "@tanstack/react-query";
import type { Client } from "@babun/shared/local/clients";
import { buildStatsMap } from "@babun/shared/local/selectors/client-stats";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingBar } from "@/components/ui/LoadingBar";
import { Spinner } from "@/components/ui/Spinner";
import { ClientDataNotice } from "@/features/clients/ClientDataNotice";
import ClientRow from "@/features/clients/ClientRow";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { useLastNonNull } from "@/lib/use-last-non-null";
import type { LucideIcon } from "lucide-react-native";
import { useCardFields, DEFAULT_CARD_FIELDS } from "@/features/clients/card-prefs";
import { useClientTags } from "@/features/clients/queries";
import { useAppointments } from "@/features/calendar/queries";
import { useTeams } from "@/features/reference/queries";
import { usePullRefresh } from "@/lib/pull-refresh";
import { useThemeColors } from "@/theme/colors";

// АРХИВ И КОРЗИНА — ОДИН ЭКРАН С ДВУМЯ НАСТРОЙКАМИ.
//
// Обе полки показывают одно и то же: клиента, убранного с глаз. Отличаются
// только вопросом («кого убрали последним» против «кого сотрут первым») и
// набором глаголов. Поэтому вёрстка общая, а разное приходит пропсами —
// иначе через месяц это были бы два экрана, разошедшихся во всём.
//
// Строка — ТА ЖЕ `ClientRow`, что в рабочем списке (владелец 2026-08-08:
// «чтоб выглядело как клиент полноценный с историей»): аватар, имя, номер,
// долг, доход, последний визит. Раньше архив рисовал свою карточку с рамкой
// и кнопкой внутри, и человек в ней выглядел записью в реестре, а не
// клиентом. Тап ведёт в ПОЛНУЮ карточку со всей историей — не в огрызок.

interface HiddenAction {
  id: string;
  label: string;
  icon: LucideIcon;
  danger?: boolean;
  run: () => Promise<void>;
}

export function HiddenClientsScreen({
  title,
  query,
  /** Подпись под именем: «в архиве с 8 авг.» / «через 27 дней». */
  caption,
  /** Хвост строки — счётчик срока в корзине. */
  trailing,
  empty,
  actions,
}: {
  title: string;
  query: UseQueryResult<Client[], Error>;
  caption: (client: Client) => string;
  trailing?: (client: Client) => ReactNode;
  empty: { title: string; subtitle: string; icon: ReactNode };
  /** Пункты меню по долгому нажатию: «Восстановить», «Стереть навсегда». */
  actions: (client: Client) => HiddenAction[];
}) {
  const t = useThemeColors();
  const router = useRouter();
  const pull = usePullRefresh(query.refetch);
  const [menuClient, setMenuClient] = useState<Client | null>(null);
  const shownMenu = useLastNonNull(menuClient);
  const [busyId, setBusyId] = useState<string | null>(null);

  const clients = useMemo(() => query.data ?? [], [query.data]);
  const { data: appointments = [] } = useAppointments();
  const { data: teams = [] } = useTeams();
  const { data: tags = [] } = useClientTags();
  const cardFields = useCardFields().data ?? DEFAULT_CARD_FIELDS;
  // Деньги и визиты считаются ТЕМ ЖЕ селектором, что в рабочем списке:
  // архивный клиент не перестаёт быть должником, и цифра под его именем
  // обязана совпадать с той, что была вчера.
  const statsMap = useMemo(
    () => buildStatsMap(clients, appointments),
    [clients, appointments],
  );

  const run = async (client: Client, label: string, action: () => Promise<void>) => {
    if (busyId) return;
    setBusyId(client.id);
    try {
      await action();
    } catch (error) {
      Alert.alert(
        `Не удалось: ${label.toLowerCase()}`,
        (error as Error).message || "Проверьте соединение и повторите.",
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title={title} />
      {query.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <Spinner size={28} label={`Загрузка: ${title.toLowerCase()}`} />
        </View>
      ) : query.isError ? (
        <ClientDataNotice
          fullScreen
          title={`Не удалось загрузить: ${title.toLowerCase()}`}
          message={query.error.message}
          onRetry={() => void query.refetch()}
          retrying={query.isRefetching}
        />
      ) : (
        <>
          <LoadingBar visible={query.isRefetching && !pull.refreshing} />
          <FlatList
            data={clients}
            keyExtractor={(client) => client.id}
            contentContainerStyle={{ paddingBottom: 32, flexGrow: 1 }}
            refreshControl={
              <RefreshControl
                refreshing={pull.refreshing}
                onRefresh={pull.onRefresh}
                tintColor={t.accent}
              />
            }
            // ДЕЙСТВИЯ ЖИВУТ ЗА ДОЛГИМ НАЖАТИЕМ, и без подписи их не найти:
            // на этих экранах нет ни свайпов, ни кнопок в строке. Одна
            // тихая строка сверху дешевле, чем кнопка в каждой строке.
            ListHeaderComponent={
              (clients.length > 0
                ? (
                    <Text
                      className="px-4 pb-1 pt-2 text-xs"
                      style={{ color: t.sub }}
                    >
                      Нажмите и удерживайте строку — вернуть или стереть
                    </Text>
                  )
                : null) as React.ReactElement | null
            }
            ItemSeparatorComponent={() => (
              <View
                className="ml-[68px] h-px"
                style={{ backgroundColor: t.separator }}
              />
            )}
            renderItem={({ item }) => {
              const stats = statsMap.get(item.id);
              const teamName = stats?.lastTeamId
                ? (teams.find((tm) => tm.id === stats.lastTeamId)?.name ?? null)
                : null;
              return (
                <View style={{ opacity: busyId === item.id ? 0.5 : 1 }}>
                  <ClientRow
                    client={item}
                    stats={stats}
                    teamName={teamName}
                    tags={tags}
                    cardFields={cardFields}
                    // Место улики статуса занимает срок: на этих полках
                    // главный вопрос — «когда убрали» и «сколько осталось».
                    evidence={caption(item)}
                    trailing={trailing?.(item)}
                    selectionMode={false}
                    picked={false}
                    // Карточка открывается ЦЕЛИКОМ — с историей, деньгами и
                    // объектами. Свайпов нет: заученный флик «убери» здесь
                    // означал бы не то, что человек ждёт.
                    onPress={() => router.push(`/clients/${item.id}`)}
                    onLongPress={() => setMenuClient(item)}
                  />
                </View>
              );
            }}
            ListEmptyComponent={
              <EmptyState
                icon={empty.icon}
                title={empty.title}
                subtitle={empty.subtitle}
              />
            }
          />
        </>
      )}

      {/* Действия — тот же канонический лист, что по долгому нажатию в
          рабочем списке. Держим последнего клиента, пока лист уезжает:
          ранний размонтаж съедал бы выездную анимацию. */}
      <PickerSheet
        visible={menuClient !== null}
        title={shownMenu?.full_name || shownMenu?.phone || "Клиент"}
        items={(shownMenu ? actions(shownMenu) : []).map((a) => ({
          id: a.id,
          label: a.label,
          icon: a.icon,
          color: a.danger ? t.danger : t.accent,
          onPress: () => {
            const client = shownMenu;
            setMenuClient(null);
            if (client) void run(client, a.label, a.run);
          },
        }))}
        onClose={() => setMenuClient(null)}
      />
    </Screen>
  );
}

/** Короткая дата того же формата, что везде: «8 авг.». */
function shortDay(date: string | null | undefined): string | null {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
  }).format(d);
}

/** Подпись архива: «в архиве с 8 авг.». */
export function ArchivedSince(date: string | null | undefined): string {
  const day = shortDay(date);
  return day ? `в архиве с ${day}` : "в архиве";
}

/** Подпись корзины: «удалён 8 авг.». Срок живёт в хвосте строки — здесь
 *  только факт, иначе обе половины строки говорят одно и то же. */
export function DeletedOn(date: string | null | undefined): string {
  const day = shortDay(date);
  return day ? `удалён ${day}` : "удалён";
}

/** Хвост корзины: «через 27 дней» / «сегодня». Считаем по КАЛЕНДАРНЫМ дням,
 *  а не по 24-часовым отрезкам: человек читает «через 3 дня» как «до конца
 *  четверга», а не «через 72 часа». */
export function DaysLeft({ purgeAt }: { purgeAt: string | null | undefined }) {
  const t = useThemeColors();
  const left = daysLeft(purgeAt);
  const soon = left !== null && left <= 3;
  return (
    <Text
      maxFontSizeMultiplier={1.3}
      className="text-[13px] font-semibold"
      style={{ color: soon ? t.danger : t.sub }}
    >
      {left === null
        ? ""
        : left <= 0
          ? "сегодня"
          : `${left} ${daysWordRu(left)}`}
    </Text>
  );
}

export function daysLeft(purgeAt: string | null | undefined): number | null {
  if (!purgeAt) return null;
  const end = new Date(purgeAt);
  if (Number.isNaN(end.getTime())) return null;
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = startOfDay(end) - startOfDay(new Date());
  return Math.max(0, Math.round(diff / 86_400_000));
}

export function daysWordRu(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "дня";
  return "дней";
}
