import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import type { Appointment } from "@babun/shared/local/appointments";
import { STATUS_LABELS, getDebtAmount } from "@babun/shared/local/appointments";
import { formatEUR } from "@babun/shared/common/utils/money";
import { formatCountRu } from "@babun/shared/common/utils/plural-ru";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { Spinner } from "@/components/ui/Spinner";
import { NavRow, RowCaption, RowGroup } from "@/components/ui/card-rows";
import { formatShortDateRu, visitsWord } from "@/features/clients/format";
import { useClientAppointments } from "@/features/clients/appointments";
import { todayYMD } from "@/features/clients/filter";
import { unpaidVisits } from "@/features/clients/unpaid-visits";
import { useClient } from "@/features/clients/queries";
import { buildTimeline, type TimelineEvent } from "@/features/clients/timeline";
import { archivedVisitTag, visitRowValue } from "@/features/clients/archived-visit";
import { useTeams } from "@/features/reference/queries";
import { useAllServices } from "@/features/services/queries";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import { ClientsCompanyRoute } from "@/features/clients/ClientsCompanyRoute";

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
// Группировка по годам: у постоянного клиента за три года набирается полсотни
// визитов, и без года «12 мар» ничего не значит. Внутри года — от свежих к
// старым. Будущие записи стоят отдельной группой сверху: это не история, это
// план, и путать их нельзя.

function yearOf(date: string): string {
  return date.slice(0, 4);
}

// Экран вкладки «Клиенты»: компанию называет источник, а не роль
// (STORY-082).
export default function ClientVisitsScreenRoute() {
  return (
    <ClientsCompanyRoute kind="card-sub">
      <ClientVisitsScreen />
    </ClientsCompanyRoute>
  );
}

function ClientVisitsScreen() {
  const t = useThemeColors();
  // `unpaid=1` — вход из сводки по «Долг €…»: только неоплаченные записи.
  const { clientId, unpaid } = useLocalSearchParams<{
    clientId: string;
    unpaid?: string;
  }>();
  const unpaidOnly = unpaid === "1";
  const { data: client } = useClient(clientId ?? "");
  const { data: appointments = [], isLoading } = useClientAppointments(
    clientId ?? "",
  );
  // Прошлые визиты — чтение: имя убранной услуги обязано пережить её.
  const { data: services = [] } = useAllServices();

  const serviceName = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of services) m.set(s.id, s.name);
    return m;
  }, [services]);
  // Справочник с архивом — только чтобы назвать команду архивного визита.
  // Ключ общий с календарём: сети это не добавляет.
  const { data: allTeams = [] } = useTeams({ includeInactive: true });
  const teamsById = useMemo(
    () => new Map(allTeams.map((team) => [team.id, team])),
    [allTeams],
  );

  const sorted = useMemo(
    () =>
      [...appointments].sort((a, b) =>
        `${b.date}${b.time_start ?? ""}`.localeCompare(
          `${a.date}${a.time_start ?? ""}`,
        ),
      ),
    [appointments],
  );

  // Локальная дата, а не UTC: `toISOString()` ночью на Кипре отдавал
  // вчерашний день, и сегодняшние визиты уезжали в «Впереди».
  const today = todayYMD();
  // НЕОПЛАЧЕННЫЕ — правилом долга из сводки (`unpaid-visits.ts`), а не
  // итогом ниже: тот складывает только выполненные, а «Долг» в сводке — ещё
  // и прошедшие незакрытые. Тапнули по €240 — список обязан дать €240.
  const unpaidList = useMemo(
    () => unpaidVisits(appointments, today),
    [appointments, today],
  );
  const unpaidIds = useMemo(
    () => new Set(unpaidList.list.map((a) => a.id)),
    [unpaidList],
  );
  // Будущая запись долгом не бывает — в фильтре группы «Впереди» нет.
  const upcoming = useMemo(
    () =>
      unpaidOnly
        ? []
        : sorted.filter(
            (a) =>
              a.date >= today && a.status !== "completed" && a.status !== "cancelled",
          ),
    [unpaidOnly, sorted, today],
  );
  const pastAppts = sorted.filter((a) => !upcoming.includes(a));

  const done = pastAppts.filter((a) => a.status === "completed");
  const spent = done.reduce(
    (n, a) => n + Math.max(0, (a.total_amount ?? 0) - getDebtAmount(a)),
    0,
  );
  const debt = done.reduce((n, a) => n + getDebtAmount(a), 0);

  // ОДНА НИТЬ ВМЕСТО ТРЁХ РАЗДЕЛОВ (2026-08-07). Раньше «что было» жило в
  // трёх местах: визиты здесь, заметки блоком на карточке, документы своей
  // страницей — и перед звонком картину собирали вручную, переключая экраны.
  // «Звонила вчера, просила перенести» и «приезжали 30 мая на €120» — это
  // одна история клиента, а не две.
  const past = useMemo(() => {
    const upcomingIds = new Set(upcoming.map((a) => a.id));
    return buildTimeline(
      client ?? null,
      appointments.filter((a) => !upcomingIds.has(a.id)),
      (id) => serviceName.get(id) ?? null,
    );
  }, [client, appointments, upcoming, serviceName]);

  const byYear = useMemo(() => {
    const groups = new Map<string, TimelineEvent[]>();
    for (const e of past) {
      // В фильтре — только записи с долгом: заметки и напоминания не долг.
      if (unpaidOnly && !(e.apptId && unpaidIds.has(e.apptId))) continue;
      const y = yearOf(e.date);
      groups.set(y, [...(groups.get(y) ?? []), e]);
    }
    return [...groups.entries()];
  }, [past, unpaidOnly, unpaidIds]);

  // Запись открывается ПОВЕРХ истории, а не через таб «Календарь».
  // Владелец 2026-07-26: «нажимаю на запись — оно открывает эту запись; если
  // нажимаю назад, возвращает в историю записей; ещё раз назад — в клиента.
  // Проблема в том, что когда захожу в запись и возвращаюсь, оно
  // перебрасывает на календарь — она не должна так делать».
  // Раньше тап уводил в другой ТАБ: история выпадала из стека, и «назад»
  // возвращал не туда, откуда пришли.
  const router = useRouter();
  const open = (a: Appointment) => {
    haptics.tap();
    router.push(`/book?appointmentId=${a.id}` as Href);
  };

  /** Значение строки: услуги, а если их нет — статус. Деньги отдельным
   *  хвостом, чтобы взгляд не искал их среди слов. */
  const visitValue = (a: Appointment) => {
    const names = (a.service_ids ?? [])
      .map((id) => serviceName.get(id))
      .filter(Boolean)
      .join(", ");
    return names || STATUS_LABELS[a.status] || "Визит";
  };

  const money = (a: Appointment) => {
    const owed = getDebtAmount(a);
    if (owed > 0) return { text: `долг ${formatEUR(owed)}`, color: t.warning };
    if (a.status === "cancelled")
      return { text: "отменён", color: t.faint };
    if ((a.total_amount ?? 0) > 0)
      return { text: formatEUR(a.total_amount), color: t.sub };
    return null;
  };

  return (
    <Screen>
      {/* ФИЛЬТР НАЗВАН В ШАПКЕ и снимается там же словом «Все» — как разрез
          ленты в «Финансах» (PanelHeader). В содержимом кнопок нет: снятый
          фильтр возвращает ту же страницу целиком, без второго захода. */}
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
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        {isLoading ? (
          <View className="items-center py-10">
            <Spinner size={26} label="Загрузка истории записей" />
          </View>
        ) : unpaidOnly ? (
          // Итог фильтра — тем же числом, что «Долг» в сводке.
          <RowCaption
            text={
              unpaidList.list.length > 0
                ? `${formatCountRu(unpaidList.list.length, ["запись", "записи", "записей"])} · долг ${formatEUR(unpaidList.total)}`
                : "Неоплаченных записей нет."
            }
            tone={unpaidList.list.length > 0 ? "warning" : "quiet"}
          />
        ) : sorted.length === 0 && past.length === 0 ? (
          <RowCaption text="Пока ничего не было." />
        ) : null}

        {/* Итог сверху — то, ради чего историю чаще всего и открывают. */}
        {!unpaidOnly && done.length > 0 ? (
          <RowCaption
            text={`${done.length} ${visitsWord(done.length)} · заплачено ${formatEUR(spent)}${
              debt > 0 ? ` · долг ${formatEUR(debt)}` : ""
            }`}
            tone={debt > 0 ? "warning" : "quiet"}
          />
        ) : null}

        {upcoming.length > 0 ? (
          <RowGroup title="Впереди">
            {upcoming.map((a, i) => {
              const m = money(a);
              return (
                <NavRow
                  key={a.id}
                  label={`${formatShortDateRu(a.date)}${a.time_start ? ` · ${a.time_start}` : ""}`}
                  value={visitRowValue({
                    tag: archivedVisitTag(a.team_id, teamsById),
                    details: [visitValue(a)],
                    money: m?.text,
                  })}
                  valueColor={m?.color}
                  separated={i > 0}
                  onPress={() => open(a)}
                />
              );
            })}
          </RowGroup>
        ) : null}

        {byYear.map(([year, list]) => (
          <RowGroup key={year} title={year}>
            {list.map((e, i) => {
              const appt = e.apptId
                ? appointments.find((a) => a.id === e.apptId)
                : undefined;
              const m = appt ? money(appt) : null;
              // Заметка и напоминание — та же строка, но без шеврона: внутрь
              // них проваливаться некуда, они целиком видны здесь.
              return (
                <NavRow
                  key={e.id}
                  label={`${formatShortDateRu(e.date)}${e.time ? ` · ${e.time}` : ""}`}
                  // Значение берём из СОБЫТИЯ ЛЕНТЫ, а не пересобираем из
                  // записи: `buildTimeline` уже разобрал услуги (новый
                  // массив `services` + легаси `service_ids`) и подобрал
                  // комментарий визита. Пересборка через `visitValue`
                  // выбрасывала и то и другое — «звонила, просила перенести»
                  // не появлялось в истории никогда, ради чего ленту и
                  // затевали.
                  value={visitRowValue({
                    // Визит архивного календаря называет свою команду
                    // (`archived-visit.ts`) — открывается он только для
                    // просмотра, и подпись объясняет почему.
                    tag: appt ? archivedVisitTag(appt.team_id, teamsById) : null,
                    details: [e.title, e.subtitle],
                    money: appt ? m?.text : null,
                  })}
                  valueColor={
                    appt ? m?.color : e.kind === "reminder" ? t.accent : t.sub
                  }
                  dimmed={e.cancelled}
                  separated={i > 0}
                  onPress={appt ? () => open(appt) : undefined}
                />
              );
            })}
          </RowGroup>
        ))}

        <View style={{ height: 8 }} />
      </ScrollView>

      {/* Запись открывается СТРАНИЦЕЙ /book (STORY-064): назад — сюда же, в
          историю визитов. */}
    </Screen>
  );
}
