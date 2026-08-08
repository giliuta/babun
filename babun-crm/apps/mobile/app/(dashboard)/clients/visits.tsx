import { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import type { Appointment } from "@babun/shared/local/appointments";
import { STATUS_LABELS, getDebtAmount } from "@babun/shared/local/appointments";
import { formatEUR } from "@babun/shared/common/utils/money";
import { AppointmentSheet } from "@/features/appointments/AppointmentSheet";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { Spinner } from "@/components/ui/Spinner";
import { NavRow, RowCaption, RowGroup } from "@/features/clients/card-rows";
import { formatShortDateRu, visitsWord } from "@/features/clients/format";
import { useClientAppointments } from "@/features/clients/appointments";
import { todayYMD } from "@/features/clients/filter";
import { useClient } from "@/features/clients/queries";
import { buildTimeline, type TimelineEvent } from "@/features/clients/timeline";
import { useServices } from "@/features/services/queries";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

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

export default function ClientVisitsScreen() {
  const t = useThemeColors();
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

  // Локальная дата, а не UTC: `toISOString()` ночью на Кипре отдавал
  // вчерашний день, и сегодняшние визиты уезжали в «Впереди».
  const today = todayYMD();
  const upcoming = sorted.filter(
    (a) => a.date >= today && a.status !== "completed" && a.status !== "cancelled",
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
      const y = yearOf(e.date);
      groups.set(y, [...(groups.get(y) ?? []), e]);
    }
    return [...groups.entries()];
  }, [past]);

  // Запись открывается ПОВЕРХ истории, а не через таб «Календарь».
  // Владелец 2026-07-26: «нажимаю на запись — оно открывает эту запись; если
  // нажимаю назад, возвращает в историю записей; ещё раз назад — в клиента.
  // Проблема в том, что когда захожу в запись и возвращаюсь, оно
  // перебрасывает на календарь — она не должна так делать».
  // Раньше тап уводил в другой ТАБ: история выпадала из стека, и «назад»
  // возвращал не туда, откуда пришли.
  const [editing, setEditing] = useState<Appointment | null>(null);
  const open = (a: Appointment) => {
    haptics.tap();
    setEditing(a);
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
        title="История"
        subtitle={client?.full_name || undefined}
      />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        {isLoading ? (
          <View className="items-center py-10">
            <Spinner size={26} label="Загрузка истории записей" />
          </View>
        ) : sorted.length === 0 && past.length === 0 ? (
          <RowCaption text="Пока ничего не было." />
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
                  value={[
                    e.title,
                    e.subtitle,
                    appt ? m?.text : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
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

      {/* Шит записи живёт ЗДЕСЬ же: закрытие возвращает в историю, а не на
          календарь. */}
      <AppointmentSheet
        visible={editing !== null}
        appointment={editing}
        onClose={() => setEditing(null)}
      />
    </Screen>
  );
}
