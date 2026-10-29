import { useMemo, useRef, useState } from "react";
import {
  ScrollView,
  Text,
  View,
} from "react-native";
import { KeyboardLift } from "@/components/ui/KeyboardLift";
import { PageFooter } from "@/components/ui/PageFooter";
import { useLocalSearchParams, useNavigation, useRouter, type Href } from "expo-router";
import { usePreventRemove } from "@react-navigation/native";
import { useBeforeUnloadWhileDirty } from "@/lib/use-before-unload";
import { confirmThen } from "@/lib/confirm";
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
import { DocumentLinkBlocks } from "@/features/invoices/DocumentLinkBlocks";
import {
  useIssueReceiptCreditNote,
  useReceipt,
  useReceiptTransaction,
  useRefundReceipt,
} from "@/features/finances/receipts-queries";
import { AmountBlock } from "@/features/finances/AmountBlock";
import { useAccountsWithBalances } from "@/features/finances/accounts";
import { buildInvoiceDocument } from "@/lib/paper/document";
import type { InvoiceLanguage } from "@/lib/paper/dictionary";
import { formatInvoiceMoney, parseMoneyAmount } from "@/lib/paper/format";
import { InvoicePreviewSheet } from "@/features/invoices/InvoicePreviewSheet";
import { InvoiceRequisitesBlock } from "@/features/invoices/InvoiceRequisitesBlock";
import { useInvoice, useNextInvoiceSeries } from "@/features/finances/invoices-queries";
import { creditNoteVat } from "@/features/invoices/credit-note-amounts";
import { useReceiptRefunds } from "@/features/documents/use-receipt-refunds";
import { useLiveBusinessToday } from "@/features/settings/live-business-today";
import { useTenant } from "@/session/tenant";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// ВОЗВРАТ ПО ЧЕКУ — ФОРМА → ПРЕВЬЮ → «ВЫПИСАТЬ»: деньги вернули,
// нужен документ. Та же архитектура,
// что у кредит-ноты к инвойсу: реквизиты с номером CN, клиент, что
// возвращаем, сумма, причина. Сервер (`refund_receipt`) одним движением
// пишет возврат на счёт чека и выписывает кредит-ноту: к чеку — на сумму
// возврата, к инвойсу — целиком (инвойс гаснет «Отменён»). Деньги записи
// возвращаются в самой записи — здесь только путь туда.
//
// ПРЕВЬЮ = ТО, ЧТО ВЫЙДЕТ. Нота к инвойсу собирается сервером из инвойса
// (`_issue_credit_note`): весь остаток инвойса, его строки с минусом, его язык
// и «Отмена инвойса …». Превью строилось как нота к чеку — человек утверждал
// «−€60 · Refund for receipt» на английском, а выходило «−€100 · Cancellation
// of INV-…» на русском.
export default function ReceiptRefundScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const { receiptId } = useLocalSearchParams<{ receiptId: string }>();
  const receiptQuery = useReceipt(receiptId);
  const receipt = receiptQuery.data ?? null;
  const txQuery = useReceiptTransaction(receipt?.transaction_id);
  const tx = txQuery.data ?? null;
  const invoiceQuery = useInvoice(receipt?.invoice_id ?? undefined);
  const invoice = receipt?.invoice_id ? invoiceQuery.data ?? null : null;
  const clients = useClients();
  const tenant = useTenant();
  const accounts = useAccountsWithBalances({
    includeInactive: true,
    includeHidden: true,
  });
  const businessToday = useLiveBusinessToday();
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

  const byInvoice = !!receipt?.invoice_id;
  // Серия ноты к инвойсу — у юрлица инвойса, язык — инвойса (выбора нет).
  const noteCompanyId = byInvoice ? invoice?.company_id ?? null : receipt?.company_id ?? null;
  const paperLanguage: InvoiceLanguage = byInvoice
    ? ((invoice?.language as InvoiceLanguage | undefined) ?? "en")
    : language;
  const series = useNextInvoiceSeries(
    Number(businessToday.slice(0, 4)),
    noteCompanyId,
    !!receipt && (!byInvoice || !!invoice),
    "credit_note",
  );

  const amountText = amount ?? formatMoneyForInput(refundable);
  const parsed = documentOnly ? uncovered : byInvoice ? refundable : parseMoneyAmount(amountText);
  const value = parsed ?? 0;
  const valid = documentOnly ? value > 0 : value > 0 && value <= refundable;
  const client =
    (clients.data ?? []).find((c) => c.id === receipt?.client_id) ?? null;
  const account =
    (accounts.data ?? []).find((a) => a.id === receipt?.account_id) ?? null;
  const defaultNote = invoice
    ? `Отмена инвойса ${invoice.number}`
    : receipt
      ? `Возврат по чеку ${receipt.number}`
      : "";

  // Черновик ноты — то, что выпустит сервер: суммы с минусом, стороны чека.
  const paperDoc = useMemo(() => {
    if (!receipt) return null;
    if (byInvoice) {
      if (!invoice) return null;
      // Как сервер: остаток инвойса; налог — остаток налога бумаги за вычетом
      // прежних нот; строки — только у первой ноты.
      const left = Math.round((invoice.total - (invoice.credited_amount ?? 0)) * 100) / 100;
      const firstNote = (invoice.credited_amount ?? 0) === 0;
      const noteVat = creditNoteVat({
        vat: invoice.vat_amount,
        total: invoice.total,
        amount: left,
        priorVat: refunds.notes
          .filter((note) => note.credit_note_of_id === invoice.id)
          .reduce((sum, note) => sum - note.vat_amount, 0),
        closes: true,
      });
      const draft: InvoiceLedgerWithLines = {
        ...invoice,
        id: "receipt-credit-note-draft",
        number: series.data?.number ?? "",
        year: Number(businessToday.slice(0, 4)),
        seq: series.data?.seq ?? 0,
        kind: "credit_note",
        credit_note_of_id: invoice.id,
        credit_partial: false,
        status: "issued",
        issued_on: businessToday,
        due_on: null,
        subtotal_net: -(left - noteVat),
        vat_amount: -noteVat,
        total: -left,
        credited_amount: 0,
        notes: reason.trim() || defaultNote,
        lines: firstNote
          ? invoice.lines.map((line) => ({ ...line, unit_price: -line.unit_price, total: -line.total }))
          : [],
      };
      return buildInvoiceDocument({
        invoice: draft,
        tenant: tenant.data ?? undefined,
        client: client ?? undefined,
        settlement: calculateInvoiceSettlement(draft, []),
        payments: [],
        language: paperLanguage,
        creditNote: { originalNumber: invoice.number },
      });
    }
    // Нота, доводящая возврат до суммы чека, несёт остаток налога чека.
    const priorNotes = refunds.notes.filter((note) => note.credit_note_of_receipt_id === receipt.id);
    const credited = priorNotes.reduce((sum, note) => sum - note.total, 0);
    const vat = creditNoteVat({
      vat: receipt.vat_amount ?? 0,
      total: receipt.amount,
      amount: value,
      priorVat: priorNotes.reduce((sum, note) => sum - note.vat_amount, 0),
      closes: Math.round((credited + value) * 100) >= Math.round(receipt.amount * 100),
    });
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
    byInvoice,
    invoice,
    refunds.notes,
    paperLanguage,
    series.data,
    businessToday,
    value,
    language,
    reason,
    defaultNote,
    tenant.data,
    client,
  ]);

  // ЗАПОЛНЕННАЯ ФОРМА НЕ ИСЧЕЗАЕТ МОЛЧА: сумму и причину свайп от края и
  // «‹» стирали без вопроса. Спрашивает сама навигация,
  // теми же словами, что черновик инвойса (`app/invoices/new.tsx`);
  // выписанный документ уходит без вопроса.
  const dirty = amount !== null || reason.trim() !== "";
  const navigation = useNavigation();
  const leavingRef = useRef(false);
  useBeforeUnloadWhileDirty(dirty);
  usePreventRemove(dirty, ({ data }) => {
    if (leavingRef.current) {
      navigation.dispatch(data.action);
      return;
    }
    confirmThen(
      // Уход с несохранённым — одни слова на весь продукт (форма записи,
      // карточка клиента, шторки правки): пачка 5, Д13.
      "Закрыть без сохранения?",
      {
        message: "Введённое не сохранится.",
        confirmLabel: "Не сохранять",
        destructive: true,
      },
      () => {
        leavingRef.current = true;
        navigation.dispatch(data.action);
      },
    );
  });

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
      <KeyboardLift
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ paddingTop: 6, paddingBottom: 32, gap: 6 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <InvoiceRequisitesBlock
            companyId={noteCompanyId}
            onCompanyChange={() => {}}
            locked
            number={
              noteCompanyId
                ? {
                    companyId: noteCompanyId,
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

        <PageFooter standalone bar>
          <GradientButton
            label={
              documentOnly
                ? `Выписать кредит-ноту · ${money}`
                : valid
                  ? `Вернуть · ${money}`
                  : "Вернуть"
            }
            disabled={!valid || !series.data || (byInvoice && !invoice)}
            onPress={() => setPreviewOpen(true)}
          />
        </PageFooter>
      </KeyboardLift>

      <InvoicePreviewSheet
        visible={previewOpen}
        doc={paperDoc}
        busy={refund.isPending || issueDocument.isPending}
        title="Кредит-нота"
        label="Выписать кредит-ноту"
        error={error}
        language={paperLanguage}
        onChangeLanguage={byInvoice ? undefined : setLanguage}
        onIssue={() => void issue()}
        onClose={() => setPreviewOpen(false)}
        onExited={() => {
          if (!issued.current) return;
          leavingRef.current = true;
          router.replace(`/invoices/${issued.current}` as Href);
        }}
      />
    </Screen>
  );
}
