import { useRef, useState } from "react";
import type { Receipt } from "@babun/shared/local/finance/receipt";
import { useLocalSearchParams, useNavigation, useRouter, type Href } from "expo-router";
import { usePreventRemove } from "@react-navigation/native";
import { useBeforeUnloadWhileDirty } from "@/lib/use-before-unload";
import { RowCaption } from "@/components/ui/card-rows";
import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { PageFooter } from "@/components/ui/PageFooter";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useToast } from "@/components/ui/Toast";
import {
  ReceiptComposer,
  receiptLinesForServer,
  receiptTotals,
  useReceiptDraft,
} from "@/features/documents/ReceiptComposer";
import { ReceiptPreviewSheet } from "@/features/documents/ReceiptPreviewSheet";
import { useIssueReceipt, useUpdateReceipt } from "@/features/finances/receipts-queries";
import { useReceiptSource } from "@/features/documents/use-receipt-source";
import { useReceiptDraftPaper } from "@/features/documents/use-receipt-draft-paper";
import { useInvoicePayments, useNextInvoiceSeries } from "@/features/finances/invoices-queries";
import { paymentFullyRefunded } from "@/lib/receipt-eligibility";
import { defaultCompany, useCompanies } from "@/features/companies/queries";
import { useCurrentRole, useTenant } from "@/session/tenant";
import { useAllServices } from "@/features/services/queries";
import { invoiceDictionary } from "@/lib/paper/dictionary";
import { useLiveBusinessToday } from "@/features/settings/live-business-today";
import { confirmThen } from "@/lib/confirm";

// НОВЫЙ ЧЕК — ТОНКИЙ МАРШРУТ НАД СОСТАВИТЕЛЕМ, как `invoices/new.tsx` над
// `InvoiceEditor`: экран держит только действие и переход, все блоки и листы
// живут в `features/documents/ReceiptComposer.tsx`.
//
// НАЛОГ ЗДЕСЬ НЕ НАЗНАЧАЕТСЯ. `vat_mode` не отправляется вовсе, и ставку
// выбирает сервер по той же лестнице, что у любой операции (счёт → команда →
// компания, `fill_transaction_vat`). Назначь мы его с устройства — бумага и
// журнал разошлись бы на ставку греческого счёта.

export default function NewReceiptScreen() {
  const router = useRouter();
  const [previewOpen, setPreviewOpen] = useState(false);
  // Выписанный чек ждёт, пока уедет предпросмотр: переход, начатый под
  // модальным листом, iOS показывал не всегда (замечено на iPhone 17e).
  const justIssued = useRef<Receipt | null>(null);
  const toast = useToast();
  const businessToday = useLiveBusinessToday();
  const params = useLocalSearchParams<{ transactionId?: string; receiptId?: string }>();
  const [draft, change] = useReceiptDraft(businessToday, null);
  const issueForPayment = useIssueReceipt();
  const updateReceipt = useUpdateReceipt();

  // ОТКУДА ЧЕК: на принятую оплату — значок чека в записи, «Выписать чек»
  // инвойса; правка выписанного — «Изменить» в листе чека, тот же номер.
  // Чека с нуля нет: деньги без оплаты чек не заводит. Заполнение —
  // `useReceiptSource`.
  const source = useReceiptSource(params, change);
  const paymentTx = source.tx;
  const editing = source.mode === "edit";
  const invoicePayments = useInvoicePayments();
  // Со снятыми из прайса: услуга визита, которую уже убрали, всё равно
  // называется своим именем, а не «Услуга» (так же берёт инвойс).
  const services = useAllServices();
  const tenant = useTenant();
  const owner = useCurrentRole().data === "owner";
  const companies = useCompanies();

  // НОМЕР ЧЕКА — В БЛОКЕ «РЕКВИЗИТЫ», КАК У ИНВОЙСА:
  // следующий номер серии этого юрлица, владелец правит его вручную. У
  // выписанного чека номер уже дан — строки нет.
  const companyId =
    source.invoiceCompanyId ?? draft.companyId ?? defaultCompany(companies.data ?? [])?.id ?? null;
  // НЕ-ВЛАДЕЛЕЦ РЕКВИЗИТЫ НЕ ВЫБИРАЕТ — их решает сервер, как у инвойса:
  // юрлицо команды платежа, иначе основное. Присланное основное у партнёра
  // команды со своим юрлицом сервер отклонит («Документ команды выставляется
  // от реквизитов этой команды»).
  const sentCompanyId = owner ? companyId : null;
  const year = Number(draft.date.slice(0, 4));
  const series = useNextInvoiceSeries(year, companyId, owner && !editing, "receipt");
  const numberTarget =
    !editing && owner && companyId
      ? { companyId, year, next: series.data ?? null, docType: "receipt" as const }
      : undefined;

  const totals = receiptTotals(draft);

  const catalog = new Map((services.data ?? []).map((s) => [s.id, s]));
  // Слова на бумаге — на языке чека, а не интерфейса.
  const paperWords = invoiceDictionary(source.language);
  const nameFor = (line: { serviceId: string; serviceName?: string }) =>
    line.serviceName ?? catalog.get(line.serviceId)?.name ?? paperWords.untitled;

  // ПРЕВЬЮ — ОБЯЗАТЕЛЬНЫЙ ШАГ: перед выпиской всегда показываем
  // превью. Собирается ровно той же моделью, что печатает PDF.
  //
  // Деньги и налог чека — проводки, а не набранного в «Итого».
  const money = { gross: paymentTx?.amount ?? 0, vat: paymentTx?.vat_amount ?? 0 };
  const paperVatRate = paymentTx?.vat_rate ?? 0;
  const currency = tenant.data?.currency || "EUR";
  // КЛИЕНТ ЧЕКА — КЛИЕНТ ПРОВОДКИ: выбора в составителе нет, а сервер
  // выпускает чек только на оплату человека.
  const clientId = paymentTx?.client_id ?? null;
  const refunded =
    source.mode === "payment" &&
    !!paymentTx?.invoice_id &&
    paymentFullyRefunded(paymentTx.id, invoicePayments.data?.[paymentTx.invoice_id]);
  // Счёт чека известен проводке; от списка счетов он не зависит.
  const problem = !source.ready
    ? "Загружаем оплату…"
    : !clientId
    ? "У оплаты нет клиента — чек выписывается на человека, поэтому на эту оплату его не выписать"
    : refunded
    ? "Оплата возвращена целиком — чек на неё не выписывается"
    : null;

  const doc = useReceiptDraftPaper({
    draft,
    numberLabel: source.editing?.number ?? series.data?.number ?? paperWords.numberPending,
    currency,
    lines: receiptLinesForServer(draft, nameFor),
    discountAmount: totals.discountAmount,
    vatRate: paperVatRate,
    vatAmount: money.vat,
    total: money.gross,
    invoiceNumber: source.invoiceNumber,
    language: source.language,
  });

  const issue = async () => {
    if (problem) return;
    const lines = receiptLinesForServer(draft, nameFor);
    try {
      const receipt = source.editing
        ? await updateReceipt.mutateAsync({
            receiptId: source.editing.id,
            lines,
            issuedOn: draft.date,
            locationId: draft.locationId,
            clientRequisitesId: draft.clientRequisitesId,
          })
        : paymentTx
        ? await issueForPayment.mutateAsync({
            transactionId: paymentTx.id,
            lines,
            companyId: sentCompanyId,
            issuedOn: draft.date,
            locationId: draft.locationId,
            clientRequisitesId: draft.clientRequisitesId,
          })
        : null;
      if (!receipt) return;
      setPreviewOpen(false);
      toast(editing ? `Чек ${receipt.number} сохранён` : `Чек ${receipt.number} выписан`, "success");
      // ВЫПИСАННЫЙ ЧЕК ОТКРЫВАЕТСЯ СВОЕЙ СТРАНИЦЕЙ, как инвойс (после
      // сохранения чек уже можно отправлять), когда
      // предпросмотр уехал.
      justIssued.current = receipt;
    } catch (error) {
      toast(error instanceof Error ? error.message : "Чек не выписан", "error");
    }
  };

  const actionLabel = editing ? "Сохранить чек" : "Выписать чек";

  // ЗАПОЛНЕННЫЙ ЧЕК НЕ ИСЧЕЗАЕТ ПО ОДНОМУ ТАПУ — как черновик инвойса: на любой
  // уход («‹», свайп от края, системное «назад») спрашивает сама навигация.
  // Грязным черновик делают только правки человека: заполнение из оплаты —
  // не его работа, и уход с нетронутого чека вопроса не стоит.
  const [dirty, setDirty] = useState(false);
  const edit = (next: Parameters<typeof change>[0]) => {
    setDirty(true);
    change(next);
  };
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

  // Ссылка без оплаты и без чека: составлять не из чего.
  if (!params.transactionId && !params.receiptId) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Новый чек" />
        <EmptyState fill title="Чек не найден" />
      </Screen>
    );
  }

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title={source.editing ? `Чек ${source.editing.number}` : "Новый чек"} />
      <ReceiptComposer
        draft={draft}
        businessToday={businessToday}
        onChange={edit}
        number={numberTarget}
        companyLocked={editing || !!source.invoiceCompanyId}
        footer={
          <PageFooter standalone bar gap={6}>
            {/* Причина — словами над кнопкой, как в «Финансах»: серая кнопка
                без объяснения читается как поломка. */}
            {problem ? <RowCaption text={problem} /> : null}
            <GradientButton
              label={actionLabel}
              disabled={!!problem}
              onPress={() => setPreviewOpen(true)}
            />
          </PageFooter>
        }
      />

      <ReceiptPreviewSheet
        visible={previewOpen}
        doc={doc}
        actionLabel={actionLabel}
        busy={issueForPayment.isPending || updateReceipt.isPending}
        onIssue={() => void issue()}
        onClose={() => setPreviewOpen(false)}
        onExited={() => {
          const receipt = justIssued.current;
          justIssued.current = null;
          // Правка уже стоит поверх страницы чека — возвращаемся на неё;
          // новый чек встаёт на место составителя своей страницей.
          if (!receipt) return;
          // Чек выписан — черновика больше нет, уход без вопроса.
          leavingRef.current = true;
          if (editing) router.back();
          else router.replace(`/documents/receipt/${receipt.id}` as Href);
        }}
      />

    </Screen>
  );
}
