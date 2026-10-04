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
import { formatMoneyForInput } from "@babun/shared/common/utils/money";
import { randomUuid } from "@babun/shared/sync";
import { tDynamic } from "@babun/shared/i18n/runtime";
import { EmptyState } from "@/components/ui/EmptyState";
import { FieldRow } from "@/components/ui/card-rows";
import { GradientButton } from "@/components/ui/GradientButton";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { useClients } from "@/features/clients/queries";
import { DocumentLinkBlocks } from "@/features/documents/DocumentLinkBlocks";
import {
  useIssueReceiptCreditNote,
  useReceipt,
  useReceiptTransaction,
  useRefundReceipt,
} from "@/features/documents/receipts-queries";
import { AmountBlock } from "@/features/finances/AmountBlock";
import { useAccountsWithBalances } from "@/features/finances/accounts";
import { buildInvoiceDocument } from "@/features/invoices/document";
import type { InvoiceLanguage } from "@/features/invoices/dictionary";
import {
  formatInvoiceMoney,
  parseMoneyAmount,
  todayYmd,
} from "@/features/invoices/format";
import { InvoicePreviewSheet } from "@/features/invoices/InvoicePreviewSheet";
import { InvoiceRequisitesBlock } from "@/features/invoices/InvoiceRequisitesBlock";
import { useNextInvoiceSeries } from "@/features/invoices/queries";
import { useReceiptRefunds } from "@/features/documents/use-receipt-refunds";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { useTenant } from "@/features/settings/tenant";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// ВОЗВРАТ ПО ЧЕКУ — ФОРМА → ПРЕВЬЮ → «ВЫПИСАТЬ» (владелец 2026-10-04:
// «оплатил, получил чек — вернули деньги, нужен документ»). Та же архитектура,
// что у кредит-ноты к инвойсу: реквизиты с номером CN, клиент, что
// возвращаем, сумма, причина. Сервер (`refund_receipt`) одним движением
// пишет возврат на счёт чека и выписывает кредит-ноту: к чеку — на сумму
// возврата, к инвойсу — целиком (инвойс гаснет «Отменён»). Деньги записи
// возвращаются в самой записи — здесь только путь туда.
export default function ReceiptRefundScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const { receiptId } = useLocalSearchParams<{ receiptId: string }>();
  const receiptQuery = useReceipt(receiptId);
  const receipt = receiptQuery.data ?? null;
  const txQuery = useReceiptTransaction(receipt?.transaction_id);
  const tx = txQuery.data ?? null;
  const clients = useClients();
  const tenant = useTenant();
  const accounts = useAccountsWithBalances({
    includeInactive: true,
    includeHidden: true,
  });
  const calendarSettings = useCalendarSettings();
  const businessToday = todayYmd(
    calendarSettings.data?.timezone ?? "Europe/Nicosia",
  );
  const refund = useRefundReceipt();
  const issueDocument = useIssueReceiptCreditNote();
  const requestId = useRef(randomUuid()).current;
  const issued = useRef<string | null>(null);

  // Сколько по чеку уже вернули и сколько из этого ещё без документа —
  // общий подсчёт со страницей чека (`useReceiptRefunds`).
  const refunds = useReceiptRefunds(receipt);
  const uncovered = refunds.uncovered;
  const documentOnly = !!receipt && !receipt.invoice_id && uncovered > 0;
  const refundable = receipt
    ? Math.max(
        0,
        Math.round((receipt.amount - refunds.refunded) * 100) / 100,
      )
    : 0;

  const [amount, setAmount] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [language, setLanguage] = useState<InvoiceLanguage>("en");
  const [error, setError] = useState<string | null>(null);

  const series = useNextInvoiceSeries(
    Number(businessToday.slice(0, 4)),
    receipt?.company_id ?? null,
    !!receipt,
    "credit_note",
  );

  const byInvoice = !!receipt?.invoice_id;
  const amountText = amount ?? formatMoneyForInput(refundable);
  const parsed = documentOnly ? uncovered : byInvoice ? refundable : parseMoneyAmount(amountText);
  const value = parsed ?? 0;
  const valid = documentOnly ? value > 0 : value > 0 && value <= refundable;
  const client =
    (clients.data ?? []).find((c) => c.id === receipt?.client_id) ?? null;
  const account =
    (accounts.data ?? []).find((a) => a.id === receipt?.account_id) ?? null;
  const defaultNote = receipt ? `Возврат по чеку ${receipt.number}` : "";

  // Черновик ноты — то, что выпустит сервер: суммы с минусом, стороны чека.
  const paperDoc = useMemo(() => {
    if (!receipt) return null;
    const vat =
      receipt.vat_amount && receipt.amount > 0
        ? Math.round(((receipt.vat_amount * value) / receipt.amount) * 100) /
          100
        : 0;
    const draft = {
      id: "receipt-credit-note-draft",
      tenant_id: receipt.tenant_id,
      number: series.data?.number ?? "",
      year: Number(businessToday.slice(0, 4)),
      seq: series.data?.seq ?? 0,
      issued_on: businessToday,
      due_on: null,
      client_id: receipt.client_id,
      appointment_id: receipt.appointment_id,
      brigade_id: receipt.team_id ?? null,
      company_id: receipt.company_id ?? null,
      account_id: receipt.account_id,
      subtotal_net: -(value - vat),
      vat_percent: receipt.vat_rate ?? 0,
      vat_amount: -vat,
      total: -value,
      currency: receipt.currency,
      language,
      status: "issued",
      kind: "credit_note",
      credit_note_of_id: null,
      credit_note_of_receipt_id: receipt.id,
      vat_mode: vat > 0 ? "inclusive" : "off",
      pdf_url: null,
      notes: reason.trim() || defaultNote,
      created_at: businessToday,
      updated_at: businessToday,
      created_by: null,
      seller_snapshot: receipt.seller_snapshot,
      client_snapshot: receipt.client_snapshot,
      lines: [],
    } as unknown as InvoiceLedgerWithLines;
    // Нота к ЧЕКУ — шапка «К чеку …» и строка «Возврат по чеку …» (словарь
    // бумаги, сессия языков).
    const receiptNote = { originalNumber: receipt.number, ofReceipt: true };
    return buildInvoiceDocument({
      invoice: draft,
      tenant: tenant.data ?? undefined,
      client: client ?? undefined,
      settlement: calculateInvoiceSettlement(draft, []),
      payments: [],
      language,
      creditNote: receiptNote,
    });
  }, [
    receipt,
    series.data,
    businessToday,
    value,
    language,
    reason,
    defaultNote,
    tenant.data,
    client,
  ]);

  if (!receipt || (receipt.transaction_id && !tx && txQuery.isLoading)) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Возврат" />
        {receiptQuery.isLoading || txQuery.isLoading ? (
          <EmptyState state="loading" fill />
        ) : (
          <EmptyState fill title="Чек не найден" />
        )}
      </Screen>
    );
  }

  // ДЕНЬГИ ЗАПИСИ — В ЗАПИСИ: их журнал и долг ведёт она, чужой возврат
  // разошёлся бы с ним. Путь — одной кнопкой внизу.
  const fromRecord =
    !!tx && (tx.source === "auto" || !!tx.appointment_payment_kind);
  if (!documentOnly && (fromRecord || receipt.status !== "issued")) {
    const openRecord = receipt.appointment_id
      ? () =>
          router.push(
            (`/(dashboard)?appointmentId=${receipt.appointment_id}` +
              `&from=${encodeURIComponent(`receipt:${receipt.id}`)}`) as Href,
          )
      : undefined;
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title={`Возврат по ${receipt.number}`} />
        <EmptyState
          fill
          title={
            fromRecord
              ? "Деньги по записи возвращаются в записи"
              : "Чек уже погашен"
          }
          subtitle={
            fromRecord
              ? "Отмените запись — клиенту вернётся оплата, а чек погаснет."
              : undefined
          }
          action={
            fromRecord && openRecord
              ? { label: "Открыть запись", onPress: openRecord }
              : undefined
          }
        />
      </Screen>
    );
  }

  const issue = async () => {
    setError(null);
    try {
      const note = documentOnly
        ? await issueDocument.mutateAsync({
            receiptId: receipt.id,
            reason: reason.trim() || null,
            language,
          })
        : await refund.mutateAsync({
            receiptId: receipt.id,
            amount: value,
            reason: reason.trim() || null,
            language,
            requestId,
          });
      haptics.success();
      issued.current = note.id;
      setPreviewOpen(false);
    } catch (refundError) {
      setError(tDynamic((refundError as Error).message));
    }
  };

  const money = formatInvoiceMoney(value, receipt.currency);
  const hint = documentOnly
    ? { text: "Деньги уже вернули — выпишем на них кредит-ноту" }
    : byInvoice
    ? { text: "Платёж инвойса возвращается целиком — инвойс отменится" }
    : amountText && parsed == null
      ? { text: "Не больше двух знаков после запятой", error: true }
      : amountText && !valid
        ? {
            text: `Не больше остатка — ${formatInvoiceMoney(refundable, receipt.currency)}`,
            error: true,
          }
        : {
            text: `Можно вернуть до ${formatInvoiceMoney(refundable, receipt.currency)}`,
          };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title={`Возврат по ${receipt.number}`} />
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
            companyId={receipt.company_id ?? null}
            onCompanyChange={() => {}}
            locked
            number={
              receipt.company_id
                ? {
                    companyId: receipt.company_id,
                    year: Number(businessToday.slice(0, 4)),
                    next: series.data
                      ? { ...series.data, canSetStart: false }
                      : null,
                  }
                : undefined
            }
          />

          {/* СУММА — ВСЯ ИЛИ ЧАСТЬ; у платежа инвойса — вся (инвойс отменяется). */}
          {byInvoice || documentOnly ? (
            <SectionCard title="Сумма">
              <View className="flex-row items-center justify-between px-4 pb-1 pt-2">
                <Text style={{ fontSize: 17, fontWeight: "600", color: t.ink }}>
                  {documentOnly ? "Возвращено" : "Вернуть"}
                </Text>
                <Text
                  style={{
                    fontSize: 20,
                    fontWeight: "700",
                    color: t.ink,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {money}
                </Text>
              </View>
              <Text
                className="px-4 pb-3"
                style={{ fontSize: 13, color: t.sub }}
              >
                {hint.text}
              </Text>
            </SectionCard>
          ) : (
            <AmountBlock
              value={amountText}
              onChange={setAmount}
              accessibilityLabel="Сумма возврата"
              hint={hint}
              selectOnFocus
            />
          )}

          {/* ЧТО ВОЗВРАЩАЕМ И С КАКОГО СЧЁТА — блоками продукта. Счёт — тот, куда
            пришли деньги: возврат уходит с него же. */}
          <DocumentLinkBlocks
            client={client}
            documents={[{ type: "receipt", item: receipt }]}
            documentsTitle="Возвращает"
            account={account}
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
            label={
              documentOnly
                ? `Выписать кредит-ноту · ${money}`
                : valid
                  ? `Вернуть · ${money}`
                  : "Вернуть"
            }
            disabled={!valid || !series.data}
            onPress={() => setPreviewOpen(true)}
          />
        </View>
      </KeyboardAvoidingView>

      <InvoicePreviewSheet
        visible={previewOpen}
        doc={paperDoc}
        busy={refund.isPending || issueDocument.isPending}
        title="Кредит-нота"
        label="Выписать кредит-ноту"
        error={error}
        language={language}
        onChangeLanguage={setLanguage}
        onIssue={() => void issue()}
        onClose={() => setPreviewOpen(false)}
        onExited={() => {
          if (issued.current)
            router.replace(`/invoices/${issued.current}` as Href);
        }}
      />
    </Screen>
  );
}
