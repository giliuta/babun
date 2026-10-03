import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import type { Receipt } from "@babun/shared/local/finance/receipt";
import { applyTxVat } from "@babun/shared/local/finance/vat";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { RowCaption } from "@/components/ui/card-rows";
import { GradientButton } from "@/components/ui/GradientButton";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useToast } from "@/components/ui/Toast";
import { paymentMethodForAccountKind } from "@/features/appointments/payment";
import {
  ReceiptComposer,
  receiptLinesForServer,
  receiptTotals,
  useReceiptDraft,
} from "@/features/documents/ReceiptComposer";
import { buildDraftReceiptDocument } from "@/features/documents/receipt-document";
import { ReceiptPreviewSheet } from "@/features/documents/ReceiptPreviewSheet";
import { ReceiptSheet } from "@/features/documents/ReceiptSheet";
import {
  useComposeReceipt,
  useIssueReceipt,
  useReceiptAppointment,
  useReceiptTransaction,
} from "@/features/documents/receipts-queries";
import { paymentReceiptLines } from "@/features/documents/receipt-for-payment";
import { useInvoice } from "@/features/invoices/queries";
import { useAccountsWithBalances } from "@/features/finances/accounts";
import { readRememberedVatRate } from "@/features/finances/remembered-vat-rate";
import { useTeamVatRate } from "@/features/finances/vat-queries";
import { useTenantId } from "@/lib/tenant";
import { useTenant } from "@/features/settings/tenant";
import { useServices } from "@/features/services/queries";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { todayYmd } from "@/features/invoices/format";

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
  const [issued, setIssued] = useState<Receipt | null>(null);
  // Выписанный чек ждёт, пока уедет предпросмотр: открытый в том же кадре
  // лист iOS не показывал — чек выписан, а на экране снова составитель
  // (проверка на 17e, 04.10).
  const justIssued = useRef<Receipt | null>(null);
  const toast = useToast();
  const calendarSettings = useCalendarSettings();
  const businessToday = todayYmd(calendarSettings.data?.timezone ?? "Europe/Nicosia");
  // Команда приходит чипом с «Финансов»: чек выписывают в той команде, где
  // на него смотрели. Внутри её можно сменить — тогда сменится и список касс.
  const params = useLocalSearchParams<{ teamId?: string; transactionId?: string }>();
  const [draft, change] = useReceiptDraft(businessToday, params.teamId ?? null);
  const compose = useComposeReceipt();
  const issueForPayment = useIssueReceipt();

  // ЧЕК НА ПРИНЯТУЮ ОПЛАТУ (владелец 2026-10-03): значок чека в оплаченной
  // записи и «Выписать чек» оплаченного инвойса ведут сюда с проводкой. Чек
  // заполняется сам — клиент, счёт, дата, строки из инвойса или записи, — и
  // человек проверяет его перед выпиской. Деньги уже в журнале: второй
  // проводки нет, чек ложится на эту (`issue_receipt`).
  const forPayment = Boolean(params.transactionId);
  const paymentTx = useReceiptTransaction(params.transactionId).data ?? null;
  const paymentInvoice = useInvoice(paymentTx?.invoice_id ?? undefined);
  const paymentAppointment = useReceiptAppointment(
    paymentTx && !paymentTx.invoice_id ? paymentTx.appointment_id : null,
  );
  const sourcesReady =
    !!paymentTx &&
    (!paymentTx.invoice_id || !paymentInvoice.isLoading) &&
    (paymentTx.invoice_id || !paymentTx.appointment_id || !paymentAppointment.isLoading);
  const seeded = useRef(false);
  useEffect(() => {
    if (!paymentTx || !sourcesReady || seeded.current) return;
    seeded.current = true;
    const invoiceNumber = paymentInvoice.data?.number;
    change({
      clientId: paymentTx.client_id,
      accountId: paymentTx.account_id,
      teamId: paymentTx.team_id ?? null,
      date: paymentTx.occurred_on,
      lines: paymentReceiptLines(
        paymentTx,
        {
          invoiceLines: paymentInvoice.data?.lines ?? null,
          appointment: paymentAppointment.data ?? null,
        },
        invoiceNumber ? `Оплата по инвойсу ${invoiceNumber}` : "Оплата",
      ),
    });
  }, [paymentTx, sourcesReady, paymentInvoice.data, paymentAppointment.data, change]);
  const accounts = useAccountsWithBalances();
  const services = useServices();
  const tenant = useTenant();
  const tenantIdForVat = useTenantId();

  const totals = receiptTotals(draft);
  const account = (accounts.data ?? []).find((a) => a.id === draft.accountId) ?? null;

  const catalog = new Map((services.data ?? []).map((s) => [s.id, s]));
  const nameFor = (line: { serviceId: string; serviceName?: string }) =>
    line.serviceName ?? catalog.get(line.serviceId)?.name ?? "Услуга";

  // ПРЕВЬЮ — ОБЯЗАТЕЛЬНЫЙ ШАГ (владелец 2026-09-20: «перед этим всегда должно
  // показывать превью»). Собирается ровно той же моделью, что печатает PDF, и
  // ровно из того, что сейчас в блоках.
  //
  // НАЛОГ В ПРЕВЬЮ СЧИТАЕТСЯ ТАК ЖЕ, КАК ЕГО ПОСЧИТАЕТ СЕРВЕР: он всегда
  // ДОСТАЁТСЯ ИЗ ПОЛУЧЕННОЙ СУММЫ (`fill_transaction_vat`), а не добавляется
  // сверху. Показать иначе значит пообещать человеку не ту цифру, что ляжет
  // на бумагу.
  // Та же ставка, что показала шторка «Итого»: написанная руками или
  // запомненная с прошлого документа (`useRememberedVatRate`).
  // Не писали ставку — ставка команды, как в шторке «Итого» составителя.
  const teamVatRate = useTeamVatRate(draft.teamId);
  const vatRate = draft.vatRate ?? readRememberedVatRate(tenantIdForVat, teamVatRate);
  // ТЕ ЖЕ ЧИСЛА, ЧТО ПОКАЗАЛА ШТОРКА «ИТОГО», И ТА ЖЕ ФУНКЦИЯ, ЧТО КЛАДЁТ
  // ДЕНЬГИ В ПРОВОДКУ (`applyTxVat`). Налог берётся ТОЛЬКО из выбора
  // человека — настройка компании отвечает за ставку, а не за «включить»
  // (владелец 2026-09-20).
  const typed = applyTxVat(totals.total, draft.vatMode, vatRate);
  // У чека на оплату деньги и налог — проводки, а не набранного в «Итого».
  const money = paymentTx
    ? { gross: paymentTx.amount, vat: paymentTx.vat_amount ?? 0 }
    : typed;
  const paperVatRate = paymentTx ? (paymentTx.vat_rate ?? 0) : vatRate;
  const currency = tenant.data?.currency || "EUR";
  const problem = forPayment && !paymentTx
    ? "Загружаем оплату…"
    : !draft.clientId
    ? "Выберите клиента — чек выписывается на человека"
    : !account
      ? "Выберите счёт — деньги всегда куда-то приходят"
      : !(money.gross > 0)
        ? "Добавьте услуги — чек на ноль не выписывается"
        : null;

  const doc = buildDraftReceiptDocument({
    numberLabel: "Черновик",
    seller: {
      name: tenant.data?.legal_name || tenant.data?.name || null,
      address: tenant.data?.business_address ?? null,
    },
    currency,
    issuedOn: draft.date,
    lines: receiptLinesForServer(draft, nameFor),
    discountAmount: totals.discountAmount,
    vatRate: paperVatRate,
    vatAmount: money.vat,
    total: money.gross,
  });

  const issue = async () => {
    if (problem || !account) return;
    try {
      const receipt = paymentTx
        ? await issueForPayment.mutateAsync({
            transactionId: paymentTx.id,
            lines: receiptLinesForServer(draft, nameFor),
            companyId: draft.companyId,
          })
        : await compose.mutateAsync({
        // Перечень замораживается в чеке сервером: выданный документ больше
        // не зависит от того, что потом станет с прайсом.
        lines: receiptLinesForServer(draft, nameFor),
        draft: {
          type: "income",
          amount: money.gross,
          client_id: draft.clientId,
          account_id: draft.accountId,
          // Команда — та, которой принадлежит счёт: деньги ложатся в её
          // календарь, и права на операцию считаются по нему же.
          team_id: draft.teamId ?? account.brigade_id,
          occurred_on: draft.date,
          // Способ оплаты выводится из вида счёта, а не спрашивается второй
          // раз: наличными на карточный счёт деньги не приходят.
          payment_method: paymentMethodForAccountKind(account.kind),
          // «Без налога» — РЕШЕНИЕ человека, а не пустое место: сервер обязан
          // его уважать, даже когда у компании налог включён.
          // СТАВКА ЕДЕТ СНИМКОМ ВСЕГДА, когда налог включён: её написал
          // человек (или она запомнена с прошлого документа), и сервер не
          // должен подменить её настройкой. `fill_transaction_vat` сверяет
          // налог с суммой и ставкой. Ставка 0 — это «без налога».
          ...(draft.vatMode !== "none" && vatRate > 0
            ? { vat_mode: draft.vatMode, vat_rate: vatRate, vat_amount: money.vat }
            : { vat_mode: "none" as const }),
          business_today: businessToday,
        },
      });
      setPreviewOpen(false);
      toast(`Чек ${receipt.number} выписан`, "success");
      // Выписанный чек открывается своим листом — из него его и отправляют
      // клиенту («потом можно уже отправить»), когда предпросмотр уехал.
      justIssued.current = receipt;
    } catch (error) {
      toast(error instanceof Error ? error.message : "Чек не выписан", "error");
    }
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Новый чек" />
      <ReceiptComposer
        draft={draft}
        businessToday={businessToday}
        onChange={change}
        forPayment={forPayment}
        // Компании живут на странице реквизитов: владелец 2026-09-20 попросил
        // совместить их в одном месте, и второй двери к ним нет.
        onOpenCompany={() => router.push("/requisites" as Href)}
        footer={
          <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10, gap: 6 }}>
            {/* Причина — словами над кнопкой, как в «Финансах»: серая кнопка
                без объяснения читается как поломка. */}
            {problem ? <RowCaption text={problem} /> : null}
            <GradientButton
              label="Выписать чек"
              disabled={!!problem}
              onPress={() => setPreviewOpen(true)}
            />
          </View>
        }
      />

      <ReceiptPreviewSheet
        visible={previewOpen}
        doc={doc}
        busy={compose.isPending || issueForPayment.isPending}
        onIssue={() => void issue()}
        onClose={() => setPreviewOpen(false)}
        onExited={() => {
          const receipt = justIssued.current;
          justIssued.current = null;
          // ПАУЗА ПОСЛЕ УХОДА — НЕ ЛИШНЯЯ: на 17e лист чека, открытый прямо
          // в `onExited`, рисовался (журнал JS) и не показывался — UIKit ещё
          // снимал окно предпросмотра, а новый лист вставал невидимым и
          // закрывал экран от касаний (04.10).
          if (receipt) setTimeout(() => setIssued(receipt), 350);
        }}
      />

      {/* Выписанный чек — тот же лист, что в ленте документов: бумага,
          «Поделиться PDF» и текстом. Закрыли — вернулись к «Финансам». */}
      <ReceiptSheet
        receipt={issued}
        appointment={null}
        accountName={account?.name ?? null}
        onClose={() => {
          setIssued(null);
          router.back();
        }}
        onOpen={(href) => router.push(href as Href)}
      />
    </Screen>
  );
}
