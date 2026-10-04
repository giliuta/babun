import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { MoreHorizontal, Share2 } from "lucide-react-native";
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
import { openReceiptMenu, receiptCanEdit } from "./receipt-menu";
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
  const [pdfBusy, setPdfBusy] = useState(false);

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
  const canEdit = receiptCanEdit(receipt);

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
  const openMenu = () => void openReceiptMenu(receipt, router);

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
            {dead ? null : (
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
            {canEdit ? (
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
            <Badge label={dead ? "Аннулирован" : "Выписан"} variant={dead ? "danger" : "success"} />
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
          documents={invoice ? [{ type: "invoice", item: invoice }] : []}
          documentsTitle="Инвойс"
          account={account}
        />
      </ScrollView>

      {/* ГЛАВНОЕ ДЕЙСТВИЕ ВЫПИСАННОГО ЧЕКА — ОТПРАВИТЬ (владелец 04.10: «и уже
          всё можно отправлять»). */}
      {dead ? null : (
        <View
          className="px-4 pb-7 pt-3"
          style={{ backgroundColor: t.surface, borderTopWidth: 1, borderTopColor: t.separator }}
        >
          <GradientButton label="Поделиться PDF" loading={busy} onPress={() => void sharePdf()} />
        </View>
      )}
    </Screen>
  );
}
