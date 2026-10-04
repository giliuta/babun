import { useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import {
  calculateInvoiceSettlement,
  type InvoiceLedgerWithLines,
} from "@babun/shared/local/finance/invoice-ledger";
import { tDynamic } from "@babun/shared/i18n/runtime";
import { formatMoneyForInput } from "@babun/shared/common/utils/money";
import { randomUuid } from "@babun/shared/sync";
import { setInvoiceLanguage } from "@babun/shared/db/repositories/invoices";
import { EmptyState } from "@/components/ui/EmptyState";
import { FieldRow } from "@/components/ui/card-rows";
import { GradientButton } from "@/components/ui/GradientButton";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { useClients } from "@/features/clients/queries";
import { DocumentLinkBlocks } from "@/features/documents/DocumentLinkBlocks";
import { buildInvoiceDocument } from "@/features/invoices/document";
import type { InvoiceLanguage } from "@/features/invoices/dictionary";
import { formatInvoiceMoney, parseMoneyAmount, todayYmd } from "@/features/invoices/format";
import { AmountBlock } from "@/features/finances/AmountBlock";
import { InvoicePreviewSheet } from "@/features/invoices/InvoicePreviewSheet";
import { InvoiceRequisitesBlock } from "@/features/invoices/InvoiceRequisitesBlock";
import {
  useCancelInvoice,
  useInvoice,
  useInvoicePayments,
  useIssuePartialCreditNote,
  useNextInvoiceSeries,
} from "@/features/invoices/queries";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { useTenant } from "@/features/settings/tenant";
import { supabase } from "@/lib/supabase";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// КРЕДИТ-НОТА — В ТОЙ ЖЕ АРХИТЕКТУРЕ, ЧТО ИНВОЙС И ЧЕК (владелец 2026-10-04:
// «сначала превью, отредактировать, и она закрепляется чётко за инвойсом —
// в одном файле»). Форма → превью → «Выписать». Реквизиты и серия — инвойса:
// CN выдаётся из серии его юрлица, дата — сегодняшний день компании.
//
// СУММА — ВСЯ ИЛИ ЧАСТЬ (04.10). Вся — инвойс отменяется (`cancel_invoice`,
// строки инвойса с минусом); часть — инвойс остаётся в силе, к оплате —
// остаток (`issue_partial_credit_note`), а если получено больше, разница
// возвращается клиенту тем же движением.
export default function CreditNoteScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const { invoiceId } = useLocalSearchParams<{ invoiceId: string }>();
  const original = useInvoice(invoiceId);
  const clients = useClients();
  const tenant = useTenant();
  const calendarSettings = useCalendarSettings();
  // Дату ноты ставит сервер (`tenant_business_date`); превью — тот же день
  // компании по её часовому поясу.
  const businessToday = todayYmd(
    calendarSettings.data?.timezone ?? "Europe/Nicosia",
  );
  const cancel = useCancelInvoice(invoiceId ?? "");
  const partial = useIssuePartialCreditNote(invoiceId ?? "");
  const paymentRows = useInvoicePayments();
  const requestId = useRef(randomUuid()).current;
  const [amountText, setAmountText] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [language, setLanguage] = useState<InvoiceLanguage | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const issued = useRef<string | null>(null);

  const row = original.data ?? null;
  const series = useNextInvoiceSeries(
    row?.year ?? new Date().getFullYear(),
    row?.company_id ?? null,
    !!row,
    "credit_note",
  );
  // По умолчанию — английский (владелец 04.10: «делай пока что всё на
  // английском»); русский — разовым выбором в превью.
  const paperLanguage: InvoiceLanguage = language ?? "en";
  const client =
    (clients.data ?? []).find((c) => c.id === row?.client_id) ?? null;
  const settlement = row
    ? calculateInvoiceSettlement(row, paymentRows.data?.[row.id] ?? [])
    : null;
  // К оплате по инвойсу сейчас (сумма минус уже сторнированное).
  const due = settlement?.due ?? row?.total ?? 0;
  const paid = settlement?.paid ?? 0;
  const text = amountText ?? (paid > 0 ? "" : formatMoneyForInput(due));
  const parsed = parseMoneyAmount(text);
  const value = parsed ?? 0;
  const whole = Math.abs(value - due) < 0.005;
  // Получено больше нового «к оплате» — столько вернётся клиенту.
  const toRefund = whole ? 0 : Math.max(0, Math.round((paid - (due - value)) * 100) / 100);
  const problem =
    !text
      ? paid > 0
        ? "Впишите, какую часть сторнировать"
        : null
      : parsed == null
        ? "Не больше двух знаков после запятой"
        : value <= 0
          ? "Сумма должна быть больше нуля"
          : value > due + 0.005
            ? `Не больше ${formatInvoiceMoney(due, row?.currency)}`
            : whole && paid > 0
              ? "По инвойсу получены деньги — на всю сумму сначала оформите возврат"
              : null;
  const valid = !!text && problem == null;

  const defaultNote = row
    ? whole
      ? `Отмена инвойса ${row.number}`
      : `Частичная отмена инвойса ${row.number}`
    : "";

  // Черновик ноты — тот самый документ, что сервер соберёт из инвойса: суммы
  // с минусом, без строк (бумага печатает одну строку «к инвойсу …»).
  const paperDoc = useMemo(() => {
    if (!row) return null;
    // Налог ноты — доля налога инвойса; строки — только у полной отмены без
    // прежних частичных (как у сервера).
    const vat = row.total > 0 ? Math.round((row.vat_amount * value) / row.total * 100) / 100 : 0;
    const fullFirst = whole && (row.credited_amount ?? 0) === 0;
    const draft: InvoiceLedgerWithLines = {
      ...row,
      id: "credit-note-draft",
      number: series.data?.number ?? "",
      kind: "credit_note",
      credit_note_of_id: row.id,
      status: "issued",
      issued_on: businessToday,
      due_on: null,
      subtotal_net: -(value - vat),
      vat_amount: -vat,
      total: -value,
      credited_amount: 0,
      notes: reason.trim() || defaultNote,
      lines: fullFirst
        ? row.lines.map((line) => ({ ...line, unit_price: -line.unit_price, total: -line.total }))
        : [],
    };
    return buildInvoiceDocument({
      invoice: draft,
      tenant: tenant.data ?? undefined,
      client: client ?? undefined,
      settlement: calculateInvoiceSettlement(draft, []),
      payments: [],
      language: paperLanguage,
      creditNote: { originalNumber: row.number },
    });
  }, [
    row,
    series.data,
    reason,
    value,
    whole,
    defaultNote,
    tenant.data,
    client,
    paperLanguage,
    businessToday,
  ]);

  if (!row) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Кредит-нота" />
        {original.isLoading ? (
          <EmptyState state="loading" fill />
        ) : (
          <EmptyState fill title="Инвойс не найден" />
        )}
      </Screen>
    );
  }

  const amount = formatInvoiceMoney(value, row.currency);
  const issue = async () => {
    setError(null);
    try {
      const note = whole
        ? await cancel.mutateAsync(reason.trim() || undefined)
        : await partial.mutateAsync({
            requestId,
            amount: value,
            reason: reason.trim() || null,
            language: paperLanguage,
          });
      // Язык — вторым шагом, как у инвойса: сервер копирует язык инвойса.
      // Не записался — нота остаётся на языке инвойса и меняется в «⋯».
      if (paperLanguage !== row.language) {
        await setInvoiceLanguage(supabase, note.id, paperLanguage).catch(
          () => undefined,
        );
      }
      haptics.success();
      issued.current = note.id;
      setPreviewOpen(false);
    } catch (submissionError) {
      setError(tDynamic((submissionError as Error).message));
    }
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title={`Кредит-нота к ${row.number}`} />
      {/* Кнопка внизу поднимается над клавиатурой, прокрутка её убирает. */}
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{ paddingTop: 6, paddingBottom: 32, gap: 6 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <InvoiceRequisitesBlock
            companyId={row.company_id ?? null}
            onCompanyChange={() => {}}
            locked
            number={
              row.company_id
                ? {
                    companyId: row.company_id,
                    year: row.year,
                    next: series.data
                      ? { ...series.data, canSetStart: false }
                      : null,
                  }
                : undefined
            }
          />

          {/* ЧТО ОТМЕНЯЕТСЯ — плашкой инвойса и блоком клиента, как на страницах
            документов. Закреплена нота будет за этим инвойсом. */}
          <DocumentLinkBlocks
            client={client}
            documents={[{ type: "invoice", item: row }]}
            documentsTitle="Отменяет"
          />

          {/* СУММА — ВСЯ (инвойс отменяется) ИЛИ ЧАСТЬ (остаётся в силе). */}
          <AmountBlock
            value={text}
            onChange={setAmountText}
            accessibilityLabel="Сумма кредит-ноты"
            selectOnFocus
            hint={
              problem
                ? { text: problem, error: !!text }
                : whole
                  ? { text: "Вся сумма — инвойс будет отменён" }
                  : toRefund > 0
                    ? { text: `Часть — инвойс остаётся, клиенту вернётся ${formatInvoiceMoney(toRefund, row.currency)}` }
                    : { text: `Часть — инвойс остаётся, к оплате ${formatInvoiceMoney(Math.max(0, due - value), row.currency)}` }
            }
          />

          <SectionCard title="Причина">
            <FieldRow
              label="Причина"
              hideLabel
              stacked
              live
              multiline
              value={reason}
              placeholder={defaultNote}
              onSave={setReason}
            />
          </SectionCard>
        </ScrollView>

        <View
          className="px-4 pb-7 pt-3"
          style={{
            backgroundColor: t.surface,
            borderTopWidth: 1,
            borderTopColor: t.separator,
          }}
        >
          <GradientButton
            label={valid ? `Выписать кредит-ноту · ${amount}` : "Выписать кредит-ноту"}
            disabled={!series.data || !valid}
            onPress={() => setPreviewOpen(true)}
          />
          {series.error ? (
            <Text
              className="mt-2 text-center text-sm"
              style={{ color: t.danger }}
            >
              {tDynamic((series.error as Error).message)}
            </Text>
          ) : null}
        </View>
      </KeyboardAvoidingView>

      <InvoicePreviewSheet
        visible={previewOpen}
        doc={paperDoc}
        busy={cancel.isPending || partial.isPending}
        title="Кредит-нота"
        label="Выписать кредит-ноту"
        error={error}
        language={paperLanguage}
        onChangeLanguage={setLanguage}
        onIssue={() => void issue()}
        onClose={() => setPreviewOpen(false)}
        // Выписанная нота открывается своей страницей, когда лист уехал.
        onExited={() => {
          if (issued.current)
            router.replace(`/invoices/${issued.current}` as Href);
        }}
      />
    </Screen>
  );
}
