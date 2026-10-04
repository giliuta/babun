import { useMemo } from "react";
import { useRouter, type Href } from "expo-router";
import { getPaidAmount } from "@babun/shared/local/appointments";
import { formatEUR } from "@babun/shared/common/utils/money";

import { NavRow } from "@/components/ui/card-rows";
import { SectionCard } from "@/components/ui/SectionCard";
import { useAppointments } from "@/features/calendar/queries";
import { useActorChanges, useCanReadHistory } from "@/features/cabinet/use-change-log";
import type { Master } from "@/features/reference/queries";

import { monthWorkOf, workLine } from "./master-work";
import { monthReceived, seenLine } from "./partner-facts";

// БЛОК «РАБОТА» НА СТРАНИЦЕ СОТРУДНИКА
// (STORY-087). Раньше они жили на отдельной странице «Информация» старой
// формой — поля в рамках, даты текстом «ГГГГ-ММ-ДД», роли старой системы
// прав. Теперь это блоки главной страницы в том же языке, что у клиента:
// строка «ярлык — значение», даты барабаном, правка на месте.
//
// Записи привязаны к КАЛЕНДАРЮ, а не к мастеру (`appointments.team_id`;
// `master_id` у работ пуст): «работа мастера» — это работа его календарей.

/** «Работа» — сводка месяца с выручкой и что он делал
 *  (владелец 04.10: «да, давай делай» по мозговому штурму страницы). */
export function MasterWorkBlock({
  card,
  teamIds,
  userId,
}: {
  card: Master;
  teamIds: readonly string[];
  /** Аккаунт партнёра — строка «История изменений». Нет — строки нет. */
  userId?: string | null;
}) {
  const router = useRouter();
  const appts = useAppointments();
  const canReadHistory = useCanReadHistory();
  const changes = useActorChanges(canReadHistory && userId ? userId : null);
  const now = new Date();
  const work = useMemo(
    () => monthWorkOf(appts.data ?? [], teamIds, new Date()),
    [appts.data, teamIds],
  );
  // Выручка — тем же правилом записи, что «Выручка» на странице записей
  // (`getPaidAmount`). Долгов команд здесь нет (владелец 04.10): это деньги
  // команды, а не его, и живут они в «Финансах».
  const received = useMemo(
    () => monthReceived(appts.data ?? [], teamIds, new Date(), getPaidAmount),
    [appts.data, teamIds],
  );
  const changesValue = changes.data
    ? changes.data.today > 0
      ? `${changes.data.today} сегодня`
      : changes.data.lastAt
        ? seenLine(changes.data.lastAt, now)
        : "пока нет"
    : null;
  return (
    <SectionCard title="Работа" padded={false}>
      {/* Одна дверь: итоги периода и записи — на одной странице. Выручка —
          числом в той же строке, а не второй строкой с той же дверью. */}
      <NavRow
        label="Записи"
        value={received > 0 ? `${workLine(work)} · ${formatEUR(received)}` : workLine(work)}
        onPress={() =>
          router.push(
            `/cabinet/people/${card.id}/visits?teams=${encodeURIComponent(teamIds.join(","))}` as Href,
          )
        }
      />
      {canReadHistory && userId ? (
        <NavRow
          label="История изменений"
          value={changesValue}
          separated
          onPress={() => router.push(`/cabinet/history?actor=${encodeURIComponent(userId)}` as Href)}
        />
      ) : null}
    </SectionCard>
  );
}
