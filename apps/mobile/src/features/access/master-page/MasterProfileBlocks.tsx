import { useMemo, useState } from "react";
import { useRouter, type Href } from "expo-router";
import { getDebtAmount, getPaidAmount } from "@babun/shared/local/appointments";
import { formatEUR } from "@babun/shared/common/utils/money";

import { FieldRow, NavRow } from "@/components/ui/card-rows";
import { DateWheelSheet } from "@/components/ui/DateWheelSheet";
import { SectionCard } from "@/components/ui/SectionCard";
import { useAppointments } from "@/features/calendar/queries";
import { useActorChanges, useCanReadHistory } from "@/features/cabinet/use-change-log";
import { formatShortDateRu } from "@/features/clients/format";
import type { MasterProfile } from "@/features/reference/master-profile";
import type { Master } from "@/features/reference/queries";
import { haptics } from "@/lib/haptics";

import { monthWorkOf, workLine } from "./master-work";
import { monthSumLine, payoutsOfMonth, seenLine, teamMoneyOf } from "./partner-facts";
import { usePartnerPayouts } from "./use-partner-payouts";
import { useMasterProfileWrite } from "./use-profile-write";

// БЛОКИ «РАБОТА», «ЛИЧНОЕ» И «ВЫПЛАТЫ» НА СТРАНИЦЕ СОТРУДНИКА
// (STORY-087). Раньше они жили на отдельной странице «Информация» старой
// формой — поля в рамках, даты текстом «ГГГГ-ММ-ДД», роли старой системы
// прав. Теперь это блоки главной страницы в том же языке, что у клиента:
// строка «ярлык — значение», даты барабаном, правка на месте.
//
// Записи привязаны к КАЛЕНДАРЮ, а не к мастеру (`appointments.team_id`;
// `master_id` у работ пуст): «работа мастера» — это работа его календарей.

/** «Работа» — сводка месяца с деньгами, долги его команд и что он делал
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
  // Деньги — тем же правилом записи, что «Выручка» на странице записей и
  // «Долги» в «Финансах» (`getPaidAmount` / `getDebtAmount`).
  const money = useMemo(
    () => teamMoneyOf(appts.data ?? [], teamIds, new Date(), getPaidAmount, getDebtAmount),
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
        value={money.received > 0 ? `${workLine(work)} · ${formatEUR(money.received)}` : workLine(work)}
        onPress={() =>
          router.push(
            `/cabinet/people/${card.id}/visits?teams=${encodeURIComponent(teamIds.join(","))}` as Href,
          )
        }
      />
      {money.debt > 0 ? (
        <NavRow
          label="Долги"
          value={formatEUR(money.debt)}
          separated
          onPress={() =>
            router.push(
              `/finances?view=debt${teamIds[0] ? `&team=${encodeURIComponent(teamIds[0])}` : ""}` as Href,
            )
          }
        />
      ) : null}
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

type DateField = "birthday" | "hire_date";

const DATE_TITLE: Record<DateField, string> = {
  birthday: "День рождения",
  // «С нами с», а не «Дата найма» (04.10): найма нет — все партнёры. Не
  // заполнена — день, когда он принял приглашение.
  hire_date: "С нами с",
};

const pad = (n: number) => String(n).padStart(2, "0");
const localYmd = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** «Личное» и «Выплаты» — поля профиля карточки мастера. */
export function MasterPersonalBlocks({
  card,
  joinedAt,
}: {
  card: Master;
  /** Когда принял приглашение — «С нами с», пока дату не поставили руками. */
  joinedAt?: string | null;
}) {
  const router = useRouter();
  const [dateOpen, setDateOpen] = useState<DateField | null>(null);
  const { profile, write, writeText } = useMasterProfileWrite(card);
  const payouts = usePartnerPayouts(card.id);
  const now = new Date();
  const paidOut = payoutsOfMonth(payouts.data ?? [], now);
  const stored = (field: DateField) => (profile[field] as string | undefined) || null;
  const dateValue = (field: DateField) =>
    stored(field) ?? (field === "hire_date" && joinedAt ? localYmd(joinedAt) : null);

  return (
    <>
      <SectionCard title="Личное" padded={false}>
        {(["birthday", "hire_date"] as const).map((field, i) => {
          const value = dateValue(field);
          return (
            <NavRow
              key={field}
              label={DATE_TITLE[field]}
              value={value ? formatShortDateRu(value) : null}
              placeholder="не указана"
              separated={i > 0}
              onPress={() => {
                haptics.tap();
                setDateOpen(field);
              }}
            />
          );
        })}
        <FieldRow
          label="Адрес"
          value={profile.address ?? ""}
          placeholder="не указан"
          autoCapitalize="sentences"
          separated
          onSave={(v) => writeText("address", v)}
        />
      </SectionCard>

      {/* «ВЫПЛАТЫ», А НЕ «БАНК И НАЛОГИ» (04.10): главное здесь — сколько ему
          выплачено; реквизиты — куда. Строка ведёт на все его выплаты. */}
      <SectionCard title="Выплаты" padded={false}>
        <NavRow
          label="Выплачено"
          value={payouts.data ? monthSumLine(paidOut, formatEUR(paidOut), now) : null}
          onPress={() => router.push(`/cabinet/people/${card.id}/payouts` as Href)}
        />
        <FieldRow
          label="IBAN"
          value={profile.iban ?? ""}
          placeholder="не указан"
          autoCapitalize="characters"
          tabular
          separated
          onSave={(v) => writeText("iban", v.replace(/\s+/g, " "))}
        />
        <FieldRow
          label="Банк"
          value={profile.bank_name ?? ""}
          placeholder="не указан"
          autoCapitalize="words"
          separated
          onSave={(v) => writeText("bank_name", v)}
        />
        <FieldRow
          label="Налоговый номер"
          value={profile.tax_number ?? ""}
          placeholder="не указан"
          autoCapitalize="characters"
          separated
          onSave={(v) => writeText("tax_number", v)}
        />
        {/* «Налоговый резидент Кипра» снят (владелец 04.10): партнёр — любой
            человек со своим аккаунтом, не обязательно из Кипра. */}
      </SectionCard>

      <DateWheelSheet
        visible={dateOpen !== null}
        title={dateOpen ? DATE_TITLE[dateOpen] : ""}
        value={dateOpen ? dateValue(dateOpen) : null}
        // День рождения не с сегодняшней даты: у неё смысла нет.
        seed={dateOpen === "birthday" ? "1990-01-01" : undefined}
        clearLabel={dateOpen && stored(dateOpen) ? "Убрать дату" : undefined}
        onApply={(ymd) => {
          if (dateOpen) write({ [dateOpen]: ymd } as MasterProfile);
          setDateOpen(null);
        }}
        onClear={() => {
          if (dateOpen) write({ [dateOpen]: null } as unknown as MasterProfile);
          setDateOpen(null);
        }}
        onClose={() => setDateOpen(null)}
      />
    </>
  );
}
