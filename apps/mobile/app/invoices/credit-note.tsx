import { useMemo, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import {
  calculateInvoiceSettlement,
  type InvoiceLedgerWithLines,
} from "@babun/shared/local/finance/invoice-ledger";
import { tDynamic } from "@babun/shared/i18n/runtime";
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
import { formatInvoiceMoney, todayYmd } from "@/features/invoices/format";
import { InvoicePreviewSheet } from "@/features/invoices/InvoicePreviewSheet";
import { InvoiceRequisitesBlock } from "@/features/invoices/InvoiceRequisitesBlock";
import {
  useCancelInvoice,
  useInvoice,
  useNextInvoiceSeries,
} from "@/features/invoices/queries";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { useTenant } from "@/features/settings/tenant";
import { supabase } from "@/lib/supabase";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// КРЕДИТ-НОТА — В ТОЙ ЖЕ АРХИТЕКТУРЕ, ЧТО ИНВОЙС И ЧЕК (владелец 2026-10-04:
// «сначала превью, отредактировать, и она закрепляется чётко за инвойсом —
// в одном файле»). Форма → превью → «Выписать». Сумма и услуги — встречные к
// инвойсу целиком (`cancel_invoice`), поэтому в форме правится только то, что
// на бумаге своё: причина отмены и язык. Реквизиты и серия — инвойса: CN
// выдаётся из серии его юрлица, дата — сегодняшний день компании.
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
  const businessToday = todayYmd(calendarSettings.data?.timezone ?? "Europe/Nicosia");
  const cancel = useCancelInvoice(invoiceId ?? "");
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
  const client = (clients.data ?? []).find((c) => c.id === row?.client_id) ?? null;

  // Черновик ноты — тот самый документ, что сервер соберёт из инвойса: суммы
  // с минусом, без строк (бумага печатает одну строку «к инвойсу …»).
  const paperDoc = useMemo(() => {
    if (!row) return null;
    const draft: InvoiceLedgerWithLines = {
      ...row,
      id: "credit-note-draft",
      number: series.data?.number ?? "",
      kind: "credit_note",
      credit_note_of_id: row.id,
      status: "issued",
      issued_on: businessToday,
      due_on: null,
      subtotal_net: -row.subtotal_net,
      vat_amount: -row.vat_amount,
      total: -row.total,
      notes: reason.trim() || `Отмена инвойса ${row.number}`,
      lines: [],
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
  }, [row, series.data, reason, tenant.data, client, paperLanguage, businessToday]);

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

  const amount = formatInvoiceMoney(-row.total, row.currency);
  const issue = async () => {
    setError(null);
    try {
      const note = await cancel.mutateAsync(reason.trim() || undefined);
      // Язык — вторым шагом, как у инвойса: сервер копирует язык инвойса.
      // Не записался — нота остаётся на языке инвойса и меняется в «⋯».
      if (paperLanguage !== row.language) {
        await setInvoiceLanguage(supabase, note.id, paperLanguage).catch(() => undefined);
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
      <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 32, gap: 6 }}>
        <InvoiceRequisitesBlock
          companyId={row.company_id ?? null}
          onCompanyChange={() => {}}
          locked
          number={
            row.company_id
              ? {
                  companyId: row.company_id,
                  year: row.year,
                  next: series.data ? { ...series.data, canSetStart: false } : null,
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

        {/* СУММА — ВСЯ, С МИНУСОМ: нота сторнирует инвойс целиком. */}
        <SectionCard title="Сумма">
          <View className="flex-row items-center justify-between px-4 pb-3 pt-2">
            <Text style={{ fontSize: 17, fontWeight: "600", color: t.ink }}>Итого</Text>
            <Text
              style={{ fontSize: 20, fontWeight: "700", color: t.ink, fontVariant: ["tabular-nums"] }}
            >
              {amount}
            </Text>
          </View>
        </SectionCard>

        <SectionCard title="Причина">
          <FieldRow
            label="Причина"
            hideLabel
            stacked
            live
            multiline
            value={reason}
            placeholder={`Отмена инвойса ${row.number}`}
            onSave={setReason}
          />
        </SectionCard>
      </ScrollView>

      <View
        className="px-4 pb-7 pt-3"
        style={{ backgroundColor: t.surface, borderTopWidth: 1, borderTopColor: t.separator }}
      >
        <GradientButton
          label={`Выписать кредит-ноту · ${amount}`}
          disabled={!series.data}
          onPress={() => setPreviewOpen(true)}
        />
        {series.error ? (
          <Text className="mt-2 text-center text-sm" style={{ color: t.danger }}>
            {tDynamic((series.error as Error).message)}
          </Text>
        ) : null}
      </View>

      <InvoicePreviewSheet
        visible={previewOpen}
        doc={paperDoc}
        busy={cancel.isPending}
        title="Кредит-нота"
        label="Выписать кредит-ноту"
        error={error}
        language={paperLanguage}
        onChangeLanguage={setLanguage}
        onIssue={() => void issue()}
        onClose={() => setPreviewOpen(false)}
        // Выписанная нота открывается своей страницей, когда лист уехал.
        onExited={() => {
          if (issued.current) router.replace(`/invoices/${issued.current}` as Href);
        }}
      />
    </Screen>
  );
}
