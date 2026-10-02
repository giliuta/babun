import { useMemo } from "react";
import { FlatList, Pressable, Text, View, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { getDebtAmount } from "@babun/shared/local/appointments";
import { formatEUR } from "@babun/shared/common/utils/money";
import { formatCountRu } from "@babun/shared/common/utils/plural-ru";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { RowCaption } from "@/components/ui/card-rows";
import { formatShortDateRu, visitsWord } from "@/features/clients/format";
import { useClientAppointments } from "@/features/clients/appointments";
import { todayYMD } from "@/features/clients/filter";
import { unpaidVisits } from "@/features/clients/unpaid-visits";
import { useClient } from "@/features/clients/queries";
import { visitStatus, type VisitStatusKind } from "@/features/clients/visit-status";
import { useTeams } from "@/features/reference/queries";
import { haptics } from "@/lib/haptics";
import { useThemeColors, type ThemeColors } from "@/theme/colors";
import { ClientsCompanyRoute } from "@/features/clients/ClientsCompanyRoute";
import { useCardAccess } from "@/features/clients/use-card-access";

// ИСТОРИЯ ЗАПИСЕЙ — полноценная страница (владелец 2026-07-26: «должна быть
// просто история записей: нажимаю — и там абсолютно все записи по этому
// клиенту, полноценная страница»).
//
// На карточке — ОДНА строка «История записей · N»: ленты там он не хочет
// («визиты вот это вот куча»). Здесь же отвечаем на вопросы в порядке их
// появления: когда → что делали → сколько → всё ли заплачено.
//
// Запись открывается ПОВЕРХ этой страницы, поэтому «назад» из записи ведёт
// в историю, а второй «назад» — к клиенту. Раньше тап уводил в таб
// «Календарь», и возврат выбрасывал человека туда же.
//
// РОВНЫЕ СТОЛБЦЫ, ОДНИМ СПИСКОМ (владелец 03.10: «в нашем стиле, чётко
// ровные столбики: дата, команда, которая выполнила, услуги не пишем;
// справа — оплачено, ожидается или долг висит; блоков „Впереди“ и „2026“
// не надо — полностью поэтапно вниз списком»). Строка — как строка в
// списке клиентов: без карточек, волосок между строками, столбец даты одной
// ширины, чтобы команда начиналась в одной точке у каждой строки. Год у
// даты пишется сам, когда он не текущий («12 мар ’25»). Заметки клиента
// в историю записей не входят — они в блоке «Заметка» карточки.

/** Цвет состояния — тем же языком, что метка визита в списке клиентов:
 *  оплачено — зелёным, долг и незакрытая — янтарём, впереди — кобальтом. */
function statusColor(kind: VisitStatusKind, t: ThemeColors): string {
  switch (kind) {
    case "paid":
      return t.success;
    case "debt":
    case "unclosed":
      return t.warning;
    case "ahead":
      return t.accent;
    case "cancelled":
      return t.faint;
    default:
      return t.sub;
  }
}

/** Место даты — под самую длинную («30 сен ’25») при крупном тексте. */
const DATE_COLUMN = 92;

// Экран вкладки «Клиенты»: компанию называет источник, а не роль
// (STORY-082).
export default function ClientVisitsScreenRoute() {
  return (
    <ClientsCompanyRoute kind="card">
      <ClientVisitsScreen />
    </ClientsCompanyRoute>
  );
}

function ClientVisitsScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const { fontScale } = useWindowDimensions();
  const dateColumn = Math.round(DATE_COLUMN * Math.min(fontScale, 1.3));
  // `unpaid=1` — вход из сводки по «Долг €…»: только неоплаченные записи.
  const { clientId, unpaid } = useLocalSearchParams<{
    clientId: string;
    unpaid?: string;
  }>();
  const { data: client } = useClient(clientId ?? "");
  // С 30.09 история открыта и сотруднику — по праву «История» этого
  // клиента; суммы и долг — по праву «Долг и деньги» (`card-access.ts`).
  const access = useCardAccess(client, false);
  const showMoney = access.money.show;
  const unpaidOnly = unpaid === "1" && showMoney;
  const { data: appointments = [], isLoading, historyOnly } = useClientAppointments(
    clientId ?? "",
  );
  // Справочник с архивом — назвать команду и архивного визита. Ключ общий с
  // календарём: сети это не добавляет.
  const { data: allTeams = [] } = useTeams({ includeInactive: true });
  const teamsById = useMemo(
    () => new Map(allTeams.map((team) => [team.id, team])),
    [allTeams],
  );

  // Локальная дата, а не UTC: `toISOString()` ночью на Кипре отдавал
  // вчерашний день.
  const today = todayYMD();
  // НЕОПЛАЧЕННЫЕ — правилом долга из сводки (`unpaid-visits.ts`): тапнули по
  // €240 — список обязан дать €240.
  const unpaidList = useMemo(
    () => unpaidVisits(appointments, today),
    [appointments, today],
  );
  const unpaidIds = useMemo(
    () => new Set(unpaidList.list.map((a) => a.id)),
    [unpaidList],
  );

  // От свежих к старым, будущие — сверху тем же списком.
  const rows = useMemo(
    () =>
      [...appointments]
        .filter((a) => !a.kind || a.kind === "work")
        .filter((a) => !unpaidOnly || unpaidIds.has(a.id))
        .sort((a, b) =>
          `${b.date}${b.time_start ?? ""}`.localeCompare(`${a.date}${a.time_start ?? ""}`),
        ),
    [appointments, unpaidOnly, unpaidIds],
  );

  // Итог сверху — то, ради чего историю чаще всего и открывают.
  const done = appointments.filter((a) => a.status === "completed");
  const spent = done.reduce(
    (n, a) => n + Math.max(0, (a.total_amount ?? 0) - getDebtAmount(a)),
    0,
  );
  const caption = unpaidOnly
    ? unpaidList.list.length > 0
      ? `${formatCountRu(unpaidList.list.length, ["запись", "записи", "записей"])} · долг ${formatEUR(unpaidList.total)}`
      : "Неоплаченных записей нет."
    : done.length > 0
      ? showMoney
        ? `${done.length} ${visitsWord(done.length)} · заплачено ${formatEUR(spent)}${
            unpaidList.total > 0 ? ` · долг ${formatEUR(unpaidList.total)}` : ""
          }`
        : `${done.length} ${visitsWord(done.length)}`
      : null;

  // Запись открывается ПОВЕРХ истории, а не через таб «Календарь»
  // (владелец 2026-07-26): «назад» — сюда, ещё раз «назад» — в клиента.
  const open = (a: Appointment) => {
    haptics.tap();
    router.push(`/book?appointmentId=${a.id}` as Href);
  };

  const teamName = (teamId: string | null | undefined) => {
    const team = teamId ? teamsById.get(teamId) : undefined;
    if (!team) return "";
    return team.is_active ? team.name : `${team.name} · в архиве`;
  };

  return (
    <Screen>
      {/* ФИЛЬТР НАЗВАН В ШАПКЕ и снимается там же словом «Все» — как разрез
          ленты в «Финансах» (PanelHeader). */}
      <ScreenHeader
        title={unpaidOnly ? "Неоплаченные" : "История"}
        subtitle={client?.full_name || undefined}
        right={
          unpaidOnly ? (
            <Pressable
              onPress={() => {
                haptics.tap();
                router.setParams({ unpaid: "" });
              }}
              accessibilityRole="button"
              accessibilityLabel="Показать всю историю"
              hitSlop={8}
              style={({ pressed }) => ({
                minHeight: 44,
                justifyContent: "center",
                paddingHorizontal: 12,
                opacity: pressed ? 0.5 : 1,
              })}
            >
              <Text
                maxFontSizeMultiplier={1.2}
                style={{ fontSize: 16, fontWeight: "600", color: t.accent }}
              >
                Все
              </Text>
            </Pressable>
          ) : undefined
        }
      />
      {!access.history.show ? null : isLoading ? (
        <EmptyState state="loading" fill title="Загрузка" />
      ) : rows.length === 0 ? (
        <EmptyState fill title={unpaidOnly ? "Неоплаченных записей нет" : "Записей пока нет"} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ paddingBottom: 32 }}
          ListHeaderComponent={
            caption ? (
              <View style={{ paddingBottom: 6 }}>
                <RowCaption
                  text={caption}
                  tone={unpaidOnly || (showMoney && unpaidList.total > 0) ? "warning" : "quiet"}
                />
              </View>
            ) : null
          }
          ItemSeparatorComponent={() => (
            <View className="ml-4 h-px" style={{ backgroundColor: t.separator }} />
          )}
          renderItem={({ item: a }) => {
            const status = visitStatus(a, today, showMoney);
            const tappable = !historyOnly.has(a.id);
            const date = formatShortDateRu(a.date);
            const team = teamName(a.team_id);
            return (
              <Pressable
                onPress={tappable ? () => open(a) : undefined}
                disabled={!tappable}
                accessibilityRole={tappable ? "button" : undefined}
                accessibilityLabel={[date, team, status.text].filter(Boolean).join(", ")}
                className="min-h-[56px] flex-row items-center py-2.5 pl-4 pr-3 active:opacity-60"
                style={{ opacity: status.kind === "cancelled" ? 0.55 : 1 }}
              >
                <Text
                  maxFontSizeMultiplier={1.3}
                  numberOfLines={1}
                  style={{
                    width: dateColumn,
                    fontSize: 16,
                    fontWeight: "600",
                    color: t.ink,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {date}
                </Text>
                <Text
                  maxFontSizeMultiplier={1.3}
                  numberOfLines={1}
                  style={{ flex: 1, fontSize: 15, color: t.body }}
                >
                  {team}
                </Text>
                <Text
                  maxFontSizeMultiplier={1.3}
                  numberOfLines={1}
                  style={{
                    marginLeft: 8,
                    fontSize: 15,
                    fontWeight: "600",
                    color: statusColor(status.kind, t),
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {status.text}
                </Text>
                <View style={{ width: 22, alignItems: "flex-end" }}>
                  {tappable ? <ChevronRight color={t.chevron} size={18} strokeWidth={2.2} /> : null}
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </Screen>
  );
}
