import { Fragment, useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useInClientsTab } from "@/features/clients/reference-href";
import type { Appointment } from "@babun/shared/local/appointments";
import { getDebtAmount } from "@babun/shared/local/appointments";
import { formatEUR } from "@babun/shared/common/utils/money";
import { formatCountRu } from "@babun/shared/common/utils/plural-ru";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { RowCaption } from "@/components/ui/card-rows";
import { SelectList } from "@/components/ui/select-rows";
import { useGuardedBookingNav } from "@/features/clients/card-booking";
import { GradientButton } from "@/components/ui/GradientButton";
import { clientBlockLevel } from "@/features/clients/client-block-access";
import { useClientsCapabilities, useClientsScopeOrNull } from "@/features/clients/company-scope";
import { useCalendarActionsReader } from "@/features/appointments/useRecordRights";
import { usePlanAllows } from "@/features/settings/tenant";
import { visitsWord } from "@/features/clients/format";
import { useClientAppointments } from "@/features/clients/appointments";
import { todayYMD } from "@/features/clients/filter";
import { unpaidVisits } from "@/features/clients/unpaid-visits";
import { useClient } from "@/features/clients/queries";
import { VisitDayHeader, VisitRow } from "@/features/clients/VisitRow";
import { useTeams } from "@/features/reference/queries";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
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
// ОДНИМ СПИСКОМ, ОТДЕЛЬНЫМИ ПЛАШКАМИ (владелец 03.10: «блоков „Впереди“ и
// „2026“ не надо — полностью поэтапно вниз списком»; «полноценные блоки,
// отдельные друг от друга, красивые, компактные» — как список тегов).
// Плашка — `VisitRow` (наш `SelectRow`) в `SelectList`.
// Услуги не пишутся; заметки клиента — в блоке «Заметка» карточки.
//
// ВНИЗУ — «ЗАПИСАТЬ КЛИЕНТА» (владелец 03.10): та же дверь, что «Записать» в
// «⋯» карточки, с тем же правом «Новые записи».

// Строка — `VisitRow`: та же, что последняя запись на карточке.

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

  // Записи одного дня — под одним заголовком, дни — от свежих к старым.
  const days = useMemo(() => {
    const byDay = new Map<string, Appointment[]>();
    for (const a of rows) byDay.set(a.date, [...(byDay.get(a.date) ?? []), a]);
    return [...byDay.entries()];
  }, [rows]);

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

  // «ЗАПИСАТЬ КЛИЕНТА» — тем же правом, что «Записать» в «⋯» карточки:
  // «Новые записи» в команде записи; партнёру — ещё и «Меню клиента».
  const guardedBook = useGuardedBookingNav();
  const calendarActionsFor = useCalendarActionsReader();
  const caps = useClientsCapabilities();
  const scope = useClientsScopeOrNull();
  const bookInPlan = usePlanAllows("book-clients");
  const bookTeam = client?.team_id ?? rows.find((a) => a.team_id)?.team_id ?? null;
  const canBook =
    !!client &&
    caps.book &&
    (scope?.kind === "member" ? clientBlockLevel(client, "clients.menu") === "write" : bookInPlan) &&
    calendarActionsFor(bookTeam).create;

  // Запись открывается ПОВЕРХ истории, а не через таб «Календарь»
  // (владелец 2026-07-26): «назад» — сюда, ещё раз «назад» — в клиента.
  const open = (a: Appointment) => {
    haptics.tap();
    router.push(`/book?appointmentId=${a.id}` as Href);
  };


  // Во вкладке нижний край держит таб-бар; поверх записи — свой.
  const inTab = useInClientsTab();
  return (
    // Нижнюю зону держит таб-бар — как у списка клиентов: иначе кнопка
    // внизу стояла на ~34pt выше, чем на соседних экранах (владелец 03.10).
    <Screen edges={inTab ? ["top"] : undefined}>
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
        <ScrollView contentContainerStyle={{ paddingTop: 4, paddingBottom: 24 }}>
          {caption ? (
            <RowCaption
              text={caption}
              tone={unpaidOnly || (showMoney && unpaidList.total > 0) ? "warning" : "quiet"}
            />
          ) : null}
          {/* День — заголовком над своими плашками, как в «Финансах»;
              плашки — отдельные, с воздухом между ними, как список тегов. */}
          {days.map(([date, list]) => (
            <Fragment key={date}>
              <VisitDayHeader date={date} />
              <SelectList>
                {list.map((a) => (
                  <VisitRow
                    key={a.id}
                    appointment={a}
                    team={a.team_id ? teamsById.get(a.team_id) : undefined}
                    today={today}
                    showMoney={showMoney}
                    // Запись чужой (не открытой сейчас) компании страница
                    // записи не прочтёт — она читает активную; такая строка —
                    // показание, а не дверь в пустой экран (аудит 03.10).
                    onPress={
                      historyOnly.has(a.id) || (scope && !scope.isActive) ? undefined : () => open(a)
                    }
                  />
                ))}
              </SelectList>
            </Fragment>
          ))}
        </ScrollView>
      )}
      {/* «Записать клиента» — внизу, на месте главного действия страницы. */}
      {client && access.history.show ? (
        // Тот же футер, что «Создать клиента» в списке: те же отступы,
        // та же высота — кнопки экранов стоят на одном уровне.
        <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 }}>
          <GradientButton
            label="Записать клиента"
            disabled={!canBook}
            onPress={() =>
              guardedBook(client, {
                locationId:
                  client.locations?.find((l) => l.isPrimary)?.id ?? client.locations?.[0]?.id ?? null,
                teamId: bookTeam,
              })
            }
          />
        </View>
      ) : null}
    </Screen>
  );
}
