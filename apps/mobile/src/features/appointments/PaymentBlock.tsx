import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { Clock, FileText } from "lucide-react-native";
import { useQuery } from "@tanstack/react-query";
import type {
  Appointment,
  AppointmentStatus,
} from "@babun/shared/local/appointments";
import { listAccounts } from "@babun/shared/db/repositories/accounts";
import { randomUuid } from "@babun/shared/sync";
import { formatEURExact } from "@babun/shared/common/utils/money";
import { MoneyField } from "@/components/ui/MoneyField";
import { SectionCard } from "@/components/ui/SectionCard";
import { useToast } from "@/components/ui/Toast";
import { chooseOption } from "@/lib/choose";
import { haptics } from "@/lib/haptics";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useThemeColors } from "@/theme/colors";
import { accountIcon } from "@/features/finances/account-ui";
import { AccountCreateSheet } from "@/features/finances/AccountCreateSheet";
import { useInvoices } from "@/features/invoices/queries";
import { useTeams } from "@/features/reference/queries";
import { useCurrentRole, useTenant } from "@/features/settings/tenant";
import { useBusinessNow } from "./business-now";
import { formatHM, humanDay } from "./helpers";
import {
  useTeamPaymentAccounts,
  type PaymentAccountOption,
} from "./payment-accounts";
import {
  amountCentsFromInput,
  amountProblem,
  blockCaption,
  closesVisit,
  outstandingCents,
  paymentRows,
  visitStarted,
  type PaymentKind,
  type PaymentRow,
} from "./payment-draft";
import { useCancelPayment, useRecordPayment } from "./payment-mutations";
import {
  InvoiceRow,
  ModeIconButton,
  NoAccountsNotice,
  PaymentBlockHeader,
  PaymentTile,
  QuietLink,
  TILE_GAP,
  useTileWidth,
} from "./PaymentTiles";

// БЛОК «ОПЛАТА» (STORY-065). Тап по счёту — деньги получены и записаны СРАЗУ
// (владелец 2026-09-06: без черновика); визит закрывается, если начался. До
// начала визита деньги принимает только режим «Предоплата» или инвойс.
// Ошибочный платёж снимает тап по зелёной плитке или «Снять» в тосте —
// сервер пишет сторно «деньги не поступили», не возврат. Деньги ждут кнопки
// только у новой записи: выбранный счёт уходит вместе с «Создать запись».

export interface PendingPayment {
  accountId: string;
  /** Евро с копейками. */
  amount: number;
  kind: PaymentKind;
}

export interface PaymentBlockProps {
  /** Сохранённая запись (правка) или null (создание): деньги — только по ней. */
  appointment: Appointment | null;
  teamId: string | null;
  /** Итог формы — сумма к оплате у ещё не созданной записи. */
  totalDraft: number;
  /** Дата, начало и статус из формы — правило «визит начался». */
  visit: { date: string; timeStart: string; status: AppointmentStatus };
  pending: PendingPayment | null;
  onPendingChange: (next: PendingPayment | null) => void;
  /** Свежая запись после оплаты/снятия — страница подтягивает статус. */
  onAppointmentChanged: (fresh: Appointment) => void;
}


export function PaymentBlock({
  appointment,
  teamId,
  totalDraft,
  visit,
  pending,
  onPendingChange,
  onAppointmentChanged,
}: PaymentBlockProps) {
  const t = useThemeColors();
  const router = useRouter();
  const toast = useToast();
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  const currency = useTenant().data?.currency;
  const businessNow = useBusinessNow();
  const tileWidth = useTileWidth();
  const { data: accounts = [], isLoading: accountsLoading } = useTeamPaymentAccounts(teamId);
  const record = useRecordPayment();
  const cancel = useCancelPayment();
  const invoicesQuery = useInvoices();
  const [mode, setMode] = useState<"pay" | "prepay">("pay");
  const [partText, setPartText] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const canCreateAccount = role === "owner" || role === "dispatcher";
  const { data: teams = [] } = useTeams();
  // Все счета тенанта — листу создания для проверки дубля имени (общий ключ).
  const accountRows = useQuery({
    queryKey: ["accounts", tenantId, "rows", "all"],
    enabled: canCreateAccount && !!tenantId && createOpen,
    queryFn: () =>
      listAccounts(supabase, tenantId as string, { includeInactive: true }),
  });

  const invoice = useMemo(() => {
    if (!appointment) return null;
    return (
      invoicesQuery.data?.find(
        (inv) =>
          inv.appointment_id === appointment.id &&
          inv.status !== "void" &&
          inv.status !== "cancelled",
      ) ?? null
    );
  }, [appointment, invoicesQuery.data]);

  const started = visitStarted(
    { date: visit.date, time_start: visit.timeStart },
    businessNow(),
  );
  const outstanding = appointment
    ? outstandingCents(appointment)
    : Math.round(totalDraft * 100);
  const rows = useMemo(
    () => (appointment ? paymentRows(appointment) : []),
    [appointment],
  );
  const rowsByAccount = useMemo(() => {
    const map = new Map<string, PaymentRow[]>();
    for (const row of rows) {
      if (!row.accountId) continue;
      map.set(row.accountId, [...(map.get(row.accountId) ?? []), row]);
    }
    return map;
  }, [rows]);
  const unattributed = rows.filter((row) => !row.accountId);
  const busy = record.isPending || cancel.isPending;
  const kindForTap: PaymentKind = mode === "prepay" ? "prepayment" : "settlement";
  const amountCents =
    partText != null ? amountCentsFromInput(partText) : outstanding;
  const problem = amountProblem(amountCents, outstanding);
  const acceptsMoney = outstanding > 0 && (started || mode === "prepay");

  const runCancel = (
    appointmentId: string,
    paymentId: string,
    accountName: string,
    amount: number,
  ) => {
    cancel.mutate(
      { appointmentId, paymentId, requestId: randomUuid() },
      {
        onSuccess: (fresh) => {
          haptics.success();
          onAppointmentChanged(fresh);
          toast(`Оплата ${formatEURExact(amount)} снята · ${accountName}`, "info");
        },
        onError: (error) => {
          haptics.error();
          toast(error instanceof Error ? error.message : "Не удалось снять оплату", "error");
        },
      },
    );
  };

  const handleTileTap = (account: PaymentAccountOption) => {
    if (outstanding <= 0 || busy) return;
    if (!started && mode !== "prepay") {
      haptics.warning();
      toast("Визит ещё не начался — нажмите «Предоплата» или «Инвойс»", "info");
      return;
    }
    if (problem === "exceeds") {
      haptics.warning();
      toast("Сумма больше остатка", "error");
      return;
    }
    if (problem === "empty") {
      haptics.warning();
      toast("Введите сумму", "error");
      return;
    }
    const amount = amountCents / 100;
    const kind = kindForTap;
    if (!appointment) {
      const same = pending?.accountId === account.id && pending.kind === kind;
      onPendingChange(same ? null : { accountId: account.id, amount, kind });
      haptics.tap();
      return;
    }
    const requestId = randomUuid();
    const closeVisit = closesVisit(
      { date: visit.date, time_start: visit.timeStart, status: appointment.status },
      kind,
      businessNow(),
    );
    record.mutate(
      { appointmentId: appointment.id, accountId: account.id, amount, requestId, kind, closeVisit },
      {
        onSuccess: (fresh) => {
          haptics.success();
          onAppointmentChanged(fresh);
          setPartText(null);
          setMode("pay");
          toast(
            `${kind === "prepayment" ? "Предоплата" : "Оплачено"} ${formatEURExact(amount)} · ${account.name}`,
            "success",
            { label: "Снять", onPress: () => runCancel(fresh.id, requestId, account.name, amount) },
          );
        },
        onError: (error) => {
          haptics.error();
          toast(error instanceof Error ? error.message : "Не удалось записать оплату", "error");
        },
      },
    );
  };

  const handlePaidTileTap = async (
    account: PaymentAccountOption,
    accountRowsForTile: PaymentRow[],
  ) => {
    const cancellable = accountRowsForTile.filter((row) => row.cancellable);
    if (!appointment || cancellable.length === 0) {
      toast("Этот платёж снимается в карточке записи", "info");
      return;
    }
    const index = await chooseOption(
      `${account.name}: деньги не поступили?`,
      cancellable.map((row) => ({
        label: `Снять ${formatEURExact(row.amount)}${row.kind === "prepayment" ? " · предоплата" : ""}${row.paidAt ? ` · ${formatHM(new Date(row.paidAt))}` : ""}`,
        destructive: true,
      })),
      { message: "Платёж уйдёт из записи, в финансах будет сторно. Это не возврат клиенту." },
    );
    if (index == null) return;
    const row = cancellable[index];
    if (!row) return;
    runCancel(appointment.id, row.id, account.name, row.amount);
  };

  const handlePrepayToggle = () => {
    haptics.tap();
    if (mode === "prepay") {
      setMode("pay");
      setPartText(null);
      return;
    }
    setMode("prepay");
    setPartText(outstanding > 0 ? String(outstanding / 100) : "");
  };

  const handleInvoice = () => {
    haptics.tap();
    if (!appointment) {
      toast("Сначала создайте запись — инвойс выставляется по ней", "info");
      return;
    }
    if (invoice) {
      router.push(`/invoices/${invoice.id}` as Href);
      return;
    }
    router.push({
      pathname: "/invoices/new",
      params: { appointmentId: appointment.id },
    } as unknown as Href);
  };

  const caption = blockCaption({
    hasTeam: Boolean(teamId),
    hasAppointment: Boolean(appointment),
    visitCompleted: appointment?.status === "completed",
    outstanding,
    rowsCount: rows.length,
    prepayMode: mode === "prepay",
    started,
    hasPending: Boolean(pending),
    outstandingLabel: formatEURExact(outstanding / 100),
  });
  const captionColor =
    caption?.tone === "success" ? t.success : caption?.tone === "danger" ? t.danger : undefined;

  const showAmountField = partText != null && outstanding > 0;
  const showPartLink =
    accounts.length > 0 && started && outstanding > 0 && mode === "pay" && !busy;

  return (
    <SectionCard>
      <PaymentBlockHeader
        sub={caption?.text}
        subColor={captionColor}
        right={
          teamId ? (
            <>
              <ModeIconButton icon={Clock} label="Предоплата" active={mode === "prepay"} onPress={handlePrepayToggle} />
              <ModeIconButton icon={FileText} label="Инвойс" active={Boolean(invoice)} onPress={handleInvoice} />
            </>
          ) : null
        }
      />
      {invoice ? (
        <InvoiceRow
          number={invoice.number}
          subtitle={`${
            invoice.status === "paid"
              ? "Оплачен"
              : invoice.due_on
                ? `Ждёт оплаты до ${humanDay(invoice.due_on)}`
                : "Ждёт оплаты"
          } · ${formatEURExact(invoice.total)}`}
          onPress={handleInvoice}
        />
      ) : null}
      {unattributed.map((row) => (
        <Text key={row.id} style={{ marginHorizontal: 16, marginTop: 4, fontSize: 13, color: t.sub }}>
          {row.kind === "prepayment" ? "Предоплата" : "Оплачено"} {formatEURExact(row.amount)} · счёт определён автоматически
        </Text>
      ))}
      {showAmountField ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 6 }}>
          <MoneyField
            label={mode === "prepay" ? "Предоплата" : "Сумма"}
            value={partText ?? ""}
            onChangeText={setPartText}
            currency={currency}
            hint={problem ? undefined : `после оплаты останется ${formatEURExact((outstanding - amountCents) / 100)}`}
            error={problem === "exceeds" ? "Больше остатка" : null}
            autoFocus
          />
        </View>
      ) : null}
      {!teamId ? null : accountsLoading ? null : accounts.length === 0 ? (
        <NoAccountsNotice canCreate={canCreateAccount} onCreate={() => setCreateOpen(true)} />
      ) : (
        <View
          className="flex-row flex-wrap"
          style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10, gap: TILE_GAP }}
        >
          {accounts.map((account) => {
            const accountRowsForTile = rowsByAccount.get(account.id) ?? [];
            const paid = accountRowsForTile.reduce((sum, row) => sum + row.amount, 0);
            const isPaid = paid > 0;
            const isPending = pending?.accountId === account.id;
            const state = isPaid ? "paid" : isPending ? "pending" : !acceptsMoney || busy ? "dim" : "idle";
            return (
              <PaymentTile
                key={account.id}
                icon={accountIcon(account)}
                label={account.name}
                color={account.color ?? t.ink}
                width={tileWidth}
                state={state}
                amount={isPaid ? formatEURExact(paid) : undefined}
                disabled={busy}
                onPress={() =>
                  isPaid ? void handlePaidTileTap(account, accountRowsForTile) : handleTileTap(account)
                }
                accessibilityLabel={
                  isPaid
                    ? `${account.name}, получено ${formatEURExact(paid)}, снять`
                    : `${account.name}, ${kindForTap === "prepayment" ? "предоплата" : "оплачено"} ${formatEURExact(amountCents / 100)}`
                }
              />
            );
          })}
        </View>
      )}
      {showPartLink ? (
        <QuietLink
          label={partText == null ? "Внести часть" : "Вся сумма"}
          onPress={() => {
            haptics.tap();
            setPartText(partText == null ? String(outstanding / 100) : null);
          }}
        />
      ) : null}
      <AccountCreateSheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        teams={teams}
        accounts={accountRows.data ?? []}
        presetTeamId={teamId}
      />
    </SectionCard>
  );
}
