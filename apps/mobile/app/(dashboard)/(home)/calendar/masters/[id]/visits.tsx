import { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import type { Appointment } from "@babun/shared/local/appointments";
import { STATUS_LABELS } from "@babun/shared/local/appointments";
import { formatEUR } from "@babun/shared/common/utils/money";
import { formatCountRu } from "@babun/shared/common/utils/plural-ru";

import { NavRow, RowCaption, RowGroup } from "@/components/ui/card-rows";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { cardTeamIds } from "@/features/access/masters-list";
import {
  WORK_PERIODS,
  workOfPeriod,
  workWindow,
  type WorkPeriod,
} from "@/features/access/master-page/master-work";
import { useAppointments } from "@/features/calendar/queries";
import { formatShortDateRu } from "@/features/clients/format";
import { todayYMD } from "@/features/clients/filter";
import { useClients } from "@/features/clients/queries";
import { useMaster, useTeams } from "@/features/reference/queries";
import { useAllServices } from "@/features/services/queries";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// «ЗАПИСИ» СОТРУДНИКА (STORY-087). Одна страница вместо двух старых портов с
// веба («Визиты» и «Статистика»): оба искали записи по `master_id`, а у работ
// он пуст — страницы всегда были пустыми. Записи принадлежат КАЛЕНДАРЮ, и
// работа сотрудника — это работа его календарей (`teams` в адресе ставит
// страница сотрудника; без него — календари карточки).
//
// Сверху период, под ним итоги периода одним блоком, ниже записи по дням —
// тем же рядом, что история клиента: дата и время слева, услуги и деньги
// справа, тап открывает запись.

export default function MasterWorkScreen() {
  const params = useLocalSearchParams<{ id: string; teams?: string }>();
  const t = useThemeColors();
  const router = useRouter();
  const cardQuery = useMaster(params.id);
  const teamsQuery = useTeams();
  const { data: appointments = [] } = useAppointments();
  const { data: clients = [] } = useClients();
  const { data: services = [] } = useAllServices();
  const [period, setPeriod] = useState<WorkPeriod>("month");
  const card = cardQuery.data ?? null;

  const teamIds = useMemo(() => {
    const fromUrl = (params.teams ?? "").split(",").filter(Boolean);
    if (fromUrl.length > 0) return fromUrl;
    return card ? cardTeamIds(card, teamsQuery.data ?? []) : [];
  }, [params.teams, card, teamsQuery.data]);

  const today = todayYMD();
  const work = useMemo(
    () => workOfPeriod(appointments, teamIds, workWindow(period, new Date()), today),
    [appointments, teamIds, period, today],
  );

  const clientName = useMemo(() => new Map(clients.map((c) => [c.id, c.full_name])), [clients]);
  const serviceName = useMemo(() => new Map(services.map((s) => [s.id, s.name])), [services]);
  const multiCalendar = teamIds.length > 1;
  const teamName = useMemo(
    () => new Map((teamsQuery.data ?? []).map((team) => [team.id, team.name])),
    [teamsQuery.data],
  );

  if (cardQuery.isLoading) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Записи" />
        <EmptyState state="loading" fill />
      </Screen>
    );
  }
  if (!card) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Записи" />
        <EmptyState fill title="Сотрудник не найден" />
      </Screen>
    );
  }

  const open = (a: Appointment) => {
    haptics.tap();
    router.push(`/book?appointmentId=${a.id}` as Href);
  };

  /** Слева — кто и что: клиент, иначе услуги, иначе статус. Календарь —
   *  только когда их у человека несколько. */
  const rowValue = (a: Appointment) => {
    const who = a.client_id ? clientName.get(a.client_id) : null;
    const what =
      (a.service_ids ?? []).map((id) => serviceName.get(id)).filter(Boolean).join(", ") ||
      STATUS_LABELS[a.status];
    const where = multiCalendar && a.team_id ? teamName.get(a.team_id) : null;
    const money = a.status !== "cancelled" && (a.total_amount ?? 0) > 0 ? formatEUR(a.total_amount) : null;
    return [who || what, where, money].filter(Boolean).join(" · ");
  };

  const row = (a: Appointment, i: number) => (
    <NavRow
      key={a.id}
      label={`${formatShortDateRu(a.date)}${a.time_start ? ` · ${a.time_start}` : ""}`}
      value={rowValue(a)}
      valueColor={a.status === "completed" ? t.success : undefined}
      dimmed={a.status === "cancelled"}
      separated={i > 0}
      onPress={() => open(a)}
    />
  );

  const s = work.summary;
  const empty = work.upcoming.length === 0 && work.past.length === 0;

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Записи" subtitle={card.full_name || undefined} />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={{ paddingHorizontal: 12, paddingTop: 12 }}>
          <SegmentedControl compact options={WORK_PERIODS} value={period} onChange={setPeriod} />
        </View>

        <SectionCard title="Итого" padded={false}>
          <NavRow label="Записей" value={String(s.total)} />
          <NavRow label="Выполнено" value={String(s.done)} separated />
          {s.cancelled > 0 ? (
            <NavRow label="Отменено" value={String(s.cancelled)} separated />
          ) : null}
          <NavRow
            label="Выручка"
            value={formatEUR(s.revenue)}
            valueColor={s.revenue > 0 ? t.success : undefined}
            separated
          />
        </SectionCard>

        {empty ? (
          <RowCaption text="За этот период записей нет." />
        ) : null}

        {work.upcoming.length > 0 ? (
          <RowGroup title="Впереди">
            {work.upcoming.flatMap((day) => day.rows).map(row)}
          </RowGroup>
        ) : null}

        {work.past.length > 0 ? (
          <RowGroup
            title={`Было · ${formatCountRu(
              work.past.reduce((n, day) => n + day.rows.length, 0),
              ["запись", "записи", "записей"],
            )}`}
          >
            {work.past.flatMap((day) => day.rows).map(row)}
          </RowGroup>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
