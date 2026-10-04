import { useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { FileMinus, MoreHorizontal, Share2 } from "lucide-react-native";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { formatInvoiceMoney } from "@/features/invoices/format";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { Spinner } from "@/components/ui/Spinner";
import { ICON } from "@/components/ui/tokens";
import { humanDay } from "@/features/appointments/helpers";
import { useClients } from "@/features/clients/queries";
import { useAccountsWithBalances } from "@/features/finances/accounts";
import { useReceiptRefunds } from "./use-receipt-refunds";
import { useReceiptMenu } from "./receipt-menu";
import { useDocumentLevel } from "./document-rights";
import { ActionMenuSheet, type ActionMenu } from "@/features/calendar/ActionMenuSheet";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import { DocumentLinkBlocks } from "./DocumentLinkBlocks";
import { ReceiptPaper } from "./ReceiptPaper";
import { buildReceiptPdfHtml } from "./receipt-pdf";
import { useReceipt } from "./receipts-queries";
import { shareHtmlAsPdf } from "./share-pdf";
import { useIssuedReceiptDoc } from "./use-issued-receipt-doc";

// СТРАНИЦА ЧЕКА — КАК СТРАНИЦА ИНВОЙСА (владелец 2026-10-04: «чек — в такой
// же архитектуре: конструкция, превью, нажимаю — сохраняется, и уже всё
// можно отправлять»). Выписанный чек живёт здесь, а не в листе: бумага, что
// с ней связано (запись, инвойс, счёт), «Поделиться PDF» внизу и в шапке,
// «Изменить чек» — в «⋯» (правка на месте, тот же номер).
export function ReceiptPage({ id }: { id: string }) {
  const t = useThemeColors();
  const router = useRouter();
  const receiptQuery = useReceipt(id);
  const receipt = receiptQuery.data ?? null;
  const accounts = useAccountsWithBalances({ includeInactive: true, includeHidden: true });
  const paper = useIssuedReceiptDoc(receipt);
  const clients = useClients();
  const refunds = useReceiptRefunds(receiptQuery.data ?? null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const receiptMenu = useReceiptMenu();
  // «ДОКУМЕНТЫ: ВИДИТ» — СМОТРИТ, НО НЕ ОТПРАВЛЯЕТ (владелец 04.10): ни
  // «Поделиться PDF», ни кнопки внизу, ни «⋯». Отправка и действия — у
  // «Выставляет» в команде чека (владельцу — всегда).
  const docWrite = useDocumentLevel(receipt?.team_id ?? null) === "write";
  const [sheetMenu, setSheetMenu] = useState<ActionMenu | null>(null);
  // «Поделиться PDF» из меню списка (04.10) — один раз, когда бумага готова.
  const { action } = useLocalSearchParams<{ action?: string }>();
  const pendingAction = useRef<string | null>(action ?? null);

  if (!receipt) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Чек" />
        {receiptQuery.isLoading ? (
          <EmptyState state="loading" fill />
        ) : receiptQuery.isError ? (
          <EmptyState
            state="error"
            fill
            title="Нет связи с сервером"
            action={{ label: "Повторить", onPress: () => void receiptQuery.refetch() }}
          />
        ) : (
          <EmptyState fill title="Чек не найден" />
        )}
      </Screen>
    );
  }

  const dead = receipt.status === "void";
  const account = (accounts.data ?? []).find((a) => a.id === receipt.account_id) ?? null;
  const appointment = paper.appointment;
  const client = (clients.data ?? []).find((c) => c.id === receipt.client_id) ?? null;
  const invoice = paper.invoice;
  // КРЕДИТ-НОТЫ ВОЗВРАТА (04.10) — к самому чеку или к его инвойсу: «вернули
  // деньги — документ закреплён за чеком».
  const notes = refunds.notes;
  // Возвращён и без ноты, если деньги вернули другой дверью (отмена визита).
  const returned = notes.length > 0 || refunds.refunded > 0;
  const openRefundDocument = () =>
    router.push(`/documents/receipt-refund?receiptId=${receipt.id}` as Href);
  // Возврат без документа — первым пунктом меню и кнопкой внизу.
  const documentItem =
    refunds.uncovered > 0
      ? [{
          label: "Кредит-нота на возврат",
          icon: FileMinus,
          color: SETTINGS_TILE.orange,
          run: openRefundDocument,
        }]
      : [];
  const hasMenu = docWrite && (documentItem.length > 0 || receiptMenu.actionsFor(receipt).length > 0);

  const sharePdf = async () => {
    if (pdfBusy || paper.linesLoading || !paper.doc) return;
    setPdfBusy(true);
    try {
      await shareHtmlAsPdf({
        html: buildReceiptPdfHtml(receipt, paper.lineItems, paper.language, paper.invoiceNumber),
        fileName: `${paper.doc.words.receipt} ${receipt.number}`,
        dialogTitle: `${paper.doc.words.receipt} ${receipt.number}`,
      });
    } catch (error) {
      notify("Не удалось поделиться PDF", (error as Error).message);
    } finally {
      setPdfBusy(false);
    }
  };


  // «⋯» — ДЕЙСТВИЯ С ЧЕКОМ, те же, что долгим нажатием в «Документах»
  // (владелец 04.10: «поделиться и прочее — лишнее»): значок в шапке и
  // кнопка внизу уже делятся PDF.
  const openMenu = () =>
    setSheetMenu(
      receiptMenu.menuFor(receipt, documentItem, {
        onDeleted: () => {
          if (router.canGoBack()) router.back();
          else router.replace("/finances?view=documents" as Href);
        },
      }),
    );

  if (pendingAction.current === "share" && docWrite && paper.doc && !paper.linesLoading) {
    pendingAction.current = null;
    setTimeout(() => void sharePdf(), 450);
  }

  const openAppointment = () => {
    if (!appointment) return;
    router.push(
      (`/(dashboard)?appointmentId=${appointment.id}&date=${appointment.date}` +
        (appointment.team_id ? `&teamId=${appointment.team_id}` : "") +
        // Закрыл запись — вернулся в этот чек, а не во вкладку денег.
        `&from=${encodeURIComponent(`receipt:${receipt.id}`)}`) as Href,
    );
  };

  const busy = pdfBusy || paper.linesLoading;

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        title={receipt.number}
        right={
          <View style={{ flexDirection: "row" }}>
            {dead || !docWrite ? null : (
              <Pressable
                onPress={busy ? undefined : () => void sharePdf()}
                disabled={busy}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Поделиться PDF"
                className="h-11 w-11 items-center justify-center rounded-full active:opacity-60"
              >
                {busy ? <Spinner size={18} label="Готовим PDF" /> : <Share2 color={t.body} size={ICON.sm} />}
              </Pressable>
            )}
            {hasMenu ? (
              <Pressable
                onPress={openMenu}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Ещё действия"
                className="h-11 w-11 items-center justify-center rounded-full active:opacity-60"
              >
                <MoreHorizontal color={t.body} size={ICON.sm} />
              </Pressable>
            ) : null}
          </View>
        }
      />

      <ScrollView className="flex-1" contentContainerStyle={{ paddingTop: 12, paddingBottom: 24 }}>
        <View style={{ paddingHorizontal: 16, gap: 12, marginBottom: 4 }}>
          {/* Статус — одной строкой над бумагой, как у инвойса. */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Badge
              label={
                dead
                  ? returned ? "Возвращён" : "Аннулирован"
                  : returned ? "Частично возвращён" : "Выписан"
              }
              variant={dead ? "danger" : returned ? "warning" : "success"}
            />
            <Text className="text-sm" style={{ color: t.sub }}>
              {humanDay(receipt.issued_on)}
            </Text>
          </View>
          {paper.doc ? <ReceiptPaper doc={paper.doc} /> : null}
        </View>

        {/* ТО, ЧЕГО НА БУМАГЕ НЕТ, — БЛОКАМИ ПРОДУКТА (владелец 04.10), теми же,
            что у страницы инвойса. */}
        <DocumentLinkBlocks
          client={client}
          locationId={receipt.location_id ?? null}
          appointment={appointment}
          onOpenAppointment={openAppointment}
          documents={[
            ...(invoice ? [{ type: "invoice" as const, item: invoice }] : []),
            ...notes.map((note) => ({ type: "invoice" as const, item: note })),
          ]}
          documentsTitle="Документы"
          account={account}
        />
      </ScrollView>

      {/* ГЛАВНОЕ ДЕЙСТВИЕ ВЫПИСАННОГО ЧЕКА — ОТПРАВИТЬ (владелец 04.10: «и уже
          всё можно отправлять»); вернули деньги без документа — выписать его,
          и у погашенного чека тоже. */}
      {!docWrite || (dead && refunds.uncovered <= 0) ? null : (
        <View
          className="px-4 pb-7 pt-3"
          style={{ backgroundColor: t.surface, borderTopWidth: 1, borderTopColor: t.separator }}
        >
          {refunds.uncovered > 0 ? (
            <GradientButton
              label={`Выписать кредит-ноту · ${formatInvoiceMoney(refunds.uncovered, receipt.currency)}`}
              onPress={openRefundDocument}
            />
          ) : (
            <GradientButton label="Поделиться PDF" loading={busy} onPress={() => void sharePdf()} />
          )}
        </View>
      )}
      <ActionMenuSheet menu={sheetMenu} onClose={() => setSheetMenu(null)} />
    </Screen>
  );
}
