import { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { Appointment } from "@babun/shared/local/appointments";
import { STATUS_LABELS, getDebtAmount } from "@babun/shared/local/appointments";
import { formatEUR } from "@babun/shared/common/utils/money";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { NavRow, RowCaption, RowGroup } from "@/features/clients/card-rows";
import { formatShortDateRu, visitsWord } from "@/features/clients/format";
import { useClientAppointments } from "@/features/clients/appointments";
import { useClient } from "@/features/clients/queries";
import { useServices } from "@/features/services/queries";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// ИСТОРИЯ ВИЗИТОВ — своя страница (владелец 2026-07-26: «история визита
// должна быть, её качественно надо проработать»).
//
// На карточке истории быть не должно — он же раньше просил убрать оттуда
// ленту: «не надо делать вот эту длинную запись, визиты вот это вот куча».
// Поэтому карточка несёт ОДНУ строку «История визитов · N», а сама лента
// живёт здесь и отвечает на вопросы в порядке их появления: когда → что
// делали → сколько → всё ли заплачено.
//
// Группировка по годам: у постоянного клиента за три года набирается полсотни
// визитов, и без года «12 мар» ничего не значит. Внутри года — от свежих к
// старым. Будущие записи стоят отдельной группой сверху: это не история, это
// план, и путать их нельзя.

function yearOf(date: string): string {
  return date.slice(0, 4);
}

export default function ClientVisitsScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const { data: client } = useClient(clientId ?? "");
  const { data: appointments = [], isLoading } = useClientAppointments(
    clientId ?? "",
  );
  const { data: services = [] } = useServices();

  const serviceName = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of services) m.set(s.id, s.name);
    return m;
  }, [services]);

  const sorted = useMemo(
    () =>
      [...appointments].sort((a, b) =>
        `${b.date}${b.time_start ?? ""}`.localeCompare(
          `${a.date}${a.time_start ?? ""}`,
        ),
      ),
    [appointments],
  );

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = sorted.filter(
    (a) => a.date >= today && a.status !== "completed" && a.status !== "cancelled",
  );
  const past = sorted.filter((a) => !upcoming.includes(a));

  const done = past.filter((a) => a.status === "completed");
  const spent = done.reduce(
    (n, a) => n + Math.max(0, (a.total_amount ?? 0) - getDebtAmount(a)),
    0,
  );
  const debt = done.reduce((n, a) => n + getDebtAmount(a), 0);

  const byYear = useMemo(() => {
    const groups = new Map<string, Appointment[]>();
    for (const a of past) {
      const y = yearOf(a.date);
      groups.set(y, [...(groups.get(y) ?? []), a]);
    }
    return [...groups.entries()];
  }, [past]);

  const open = (a: Appointment) => {
    haptics.tap();
    router.push({
      pathname: "/(dashboard)",
      params: {
        appointmentId: a.id,
        date: a.date,
        ...(a.team_id ? { teamId: a.team_id } : {}),
      },
    });
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
      <ScreenHeader
        title="История визитов"
        subtitle={client?.full_name || undefined}
      />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        {isLoading ? (
          <RowCaption text="Загрузка…" />
        ) : sorted.length === 0 ? (
          <RowCaption text="Визитов ещё не было." />
        ) : null}

        {/* Итог сверху — то, ради чего историю чаще всего и открывают. */}
        {done.length > 0 ? (
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
                  value={m ? `${visitValue(a)} · ${m.text}` : visitValue(a)}
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
            {list.map((a, i) => {
              const m = money(a);
              return (
                <NavRow
                  key={a.id}
                  label={`${formatShortDateRu(a.date)}${a.time_start ? ` · ${a.time_start}` : ""}`}
                  value={m ? `${visitValue(a)} · ${m.text}` : visitValue(a)}
                  valueColor={m?.color}
                  dimmed={a.status === "cancelled"}
                  separated={i > 0}
                  onPress={() => open(a)}
                />
              );
            })}
          </RowGroup>
        ))}

        <View style={{ height: 8 }} />
        <Text
          maxFontSizeMultiplier={1.3}
          style={{
            marginHorizontal: 16,
            fontSize: 13,
            color: t.faint,
          }}
        >
          Тап по визиту открывает его в календаре.
        </Text>
      </ScrollView>
    </Screen>
  );
}
