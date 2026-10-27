import { useRef, useState } from "react";
import { View } from "react-native";
import type { Receipt } from "@babun/shared/local/finance/receipt";
import { applyTxVat } from "@babun/shared/local/finance/vat";
import { useLocalSearchParams, useNavigation, useRouter, type Href } from "expo-router";
import { usePreventRemove } from "@react-navigation/native";
import { useBeforeUnloadWhileDirty } from "@/lib/use-before-unload";
import { randomUuid } from "@babun/shared/sync";
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
import { ReceiptPreviewSheet } from "@/features/documents/ReceiptPreviewSheet";
import {
  useComposeReceipt,
  useIssueReceipt,
  useUpdateReceipt,
} from "@/features/finances/receipts-queries";
import { useReceiptSource } from "@/features/documents/use-receipt-source";
import { useReceiptDraftPaper } from "@/features/documents/use-receipt-draft-paper";
import { useInvoicePayments, useNextInvoiceSeries } from "@/features/finances/invoices-queries";
import { paymentFullyRefunded } from "@/lib/receipt-eligibility";
import { defaultCompany, useCompanies } from "@/features/companies/queries";
import { useAccountsWithBalances } from "@/features/finances/accounts";
import { readRememberedVatRate } from "@/features/finances/remembered-vat-rate";
import { useTeamVatRate } from "@/features/finances/vat-queries";
import { useTenantId } from "@/lib/tenant";
import { useCurrentRole, useTenant } from "@/session/tenant";
import { useAllServices } from "@/features/services/queries";
import { invoiceDictionary } from "@/lib/paper/dictionary";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { todayYmd } from "@/lib/paper/format";
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
  const calendarSettings = useCalendarSettings();
  const businessToday = todayYmd(calendarSettings.data?.timezone ?? "Europe/Nicosia");
  // Команда приходит чипом с «Финансов»: чек выписывают в той команде, где
  // на него смотрели. Внутри её можно сменить — тогда сменится и список касс.
  const params = useLocalSearchParams<{ teamId?: string; transactionId?: string; receiptId?: string }>();
  const [draft, change] = useReceiptDraft(businessToday, params.teamId ?? null);
  const compose = useComposeReceipt();
  // Id попытки чека с нуля: повтор после ошибки бумаги не пишет второй
  // приход (`composeReceipt`). Новый — только после успешной выписки.
  const [composeRequestId, setComposeRequestId] = useState(() => randomUuid());
  const issueForPayment = useIssueReceipt();
  const updateReceipt = useUpdateReceipt();

  // ОТКУДА ЧЕК: с нуля; на принятую оплату — значок
  // чека в записи, «Выписать чек» инвойса; правка выписанного — «Изменить» в
  // листе чека, тот же номер. Заполнение — `useReceiptSource`.
  const source = useReceiptSource(params, change);
  const paymentTx = source.tx;
  const editing = source.mode === "edit";
  const forPayment = source.mode !== "new";
  // ЧЕК НА ОПЛАТУ БЕРЁТ СЧЁТ ИЗ САМОЙ ПРОВОДКИ, а деньги могли прийти на счёт,
  // который потом скрыли или закрыли: живой список его не знает, и чек вставал
  // бы на «Выберите счёт» без выхода. Свободный чек выбирает только из живых.
  const accounts = useAccountsWithBalances(
    forPayment ? { includeInactive: true, includeHidden: true, includeDeleted: true } : undefined,
  );
  const invoicePayments = useInvoicePayments();
  // Со снятыми из прайса: услуга визита, которую уже убрали, всё равно
  // называется своим именем, а не «Услуга» (так же берёт инвойс).
  const services = useAllServices();
  const tenant = useTenant();
  const tenantIdForVat = useTenantId();
  const owner = useCurrentRole().data === "owner";
  const companies = useCompanies();

  // НОМЕР ЧЕКА — В БЛОКЕ «РЕКВИЗИТЫ», КАК У ИНВОЙСА:
  // следующий номер серии этого юрлица, владелец правит его вручную. У
  // выписанного чека номер уже дан — строки нет.
  const companyId =
    source.invoiceCompanyId ?? draft.companyId ?? defaultCompany(companies.data ?? [])?.id ?? null;
  const year = Number(draft.date.slice(0, 4));
  const series = useNextInvoiceSeries(year, companyId, owner && !editing, "receipt");
  const numberTarget =
    !editing && owner && companyId
      ? { companyId, year, next: series.data ?? null, docType: "receipt" as const }
      : undefined;

  const totals = receiptTotals(draft);
  const account = (accounts.data ?? []).find((a) => a.id === draft.accountId) ?? null;

  const catalog = new Map((services.data ?? []).map((s) => [s.id, s]));
  // Слова на бумаге — на языке чека, а не интерфейса.
  const paperWords = invoiceDictionary(source.language);
  const nameFor = (line: { serviceId: string; serviceName?: string }) =>
    line.serviceName ?? catalog.get(line.serviceId)?.name ?? paperWords.untitled;

  // ПРЕВЬЮ — ОБЯЗАТЕЛЬНЫЙ ШАГ: перед выпиской всегда показываем
  // превью. Собирается ровно той же моделью, что печатает PDF.
  //
  // НАЛОГ ЧЕКА С НУЛЯ СЧИТАЕТСЯ ТАК ЖЕ, КАК ЕГО ПОСЧИТАЕТ СЕРВЕР: изнутри
  // полученной суммы (`fill_transaction_vat`); ставка — набранная в «Итого»
  // или запомненная с прошлого документа, иначе ставка команды.
  const teamVatRate = useTeamVatRate(draft.teamId);
  const vatRate = draft.vatRate ?? readRememberedVatRate(tenantIdForVat, teamVatRate);
  const typed = applyTxVat(totals.total, draft.vatMode, vatRate);
  // У чека на оплату деньги и налог — проводки, а не набранного в «Итого».
  const money = paymentTx
    ? { gross: paymentTx.amount, vat: paymentTx.vat_amount ?? 0 }
    : typed;
  const paperVatRate = paymentTx ? (paymentTx.vat_rate ?? 0) : vatRate;
  const currency = tenant.data?.currency || "EUR";
  // КЛИЕНТ ЧЕКА НА ОПЛАТУ — КЛИЕНТ ЕЁ ПРОВОДКИ: выбор в составителе отключён, а
  // сервер выпускает чек только на оплату человека.
  const clientId = forPayment ? (paymentTx?.client_id ?? null) : draft.clientId;
  const refunded =
    source.mode === "payment" &&
    !!paymentTx?.invoice_id &&
    paymentFullyRefunded(paymentTx.id, invoicePayments.data?.[paymentTx.invoice_id]);
  // Счёт чека на оплату известен проводке; от списка счетов он не зависит.
  const problem = forPayment && !source.ready
    ? "Загружаем оплату…"
    : forPayment && !clientId
    ? "У оплаты нет клиента — чек выписывается на человека, поэтому на эту оплату его не выписать"
    : refunded
    ? "Оплата возвращена целиком — чек на неё не выписывается"
    : !clientId
    ? "Выберите клиента — чек выписывается на человека"
    : !forPayment && !account
      ? "Выберите счёт — деньги всегда куда-то приходят"
      : !(money.gross > 0)
        ? "Добавьте услуги — чек на ноль не выписывается"
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
            companyId,
            issuedOn: draft.date,
            locationId: draft.locationId,
            clientRequisitesId: draft.clientRequisitesId,
          })
        : !account
        ? null
        : await compose.mutateAsync({
        requestId: composeRequestId,
        // Перечень замораживается в чеке сервером: выданный документ больше
        // не зависит от того, что потом станет с прайсом.
        lines,
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
          // «Без налога» — РЕШЕНИЕ человека, а не пустое место; ставка едет
          // снимком, когда налог включён (`fill_transaction_vat` сверяет).
          ...(draft.vatMode !== "none" && vatRate > 0
            ? { vat_mode: draft.vatMode, vat_rate: vatRate, vat_amount: money.vat }
            : { vat_mode: "none" as const }),
          business_today: businessToday,
        },
      });
      if (!receipt) return;
      if (!source.editing && !paymentTx) setComposeRequestId(randomUuid());
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
      "Черновик не сохранён",
      {
        message: "Уйти и потерять заполненное?",
        confirmLabel: "Уйти",
        destructive: true,
      },
      () => {
        leavingRef.current = true;
        navigation.dispatch(data.action);
      },
    );
  });

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title={source.editing ? `Чек ${source.editing.number}` : "Новый чек"} />
      <ReceiptComposer
        draft={draft}
        businessToday={businessToday}
        onChange={edit}
        forPayment={forPayment}
        number={numberTarget}
        companyLocked={editing || !!source.invoiceCompanyId}
        footer={
          <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10, gap: 6 }}>
            {/* Причина — словами над кнопкой, как в «Финансах»: серая кнопка
                без объяснения читается как поломка. */}
            {problem ? <RowCaption text={problem} /> : null}
            <GradientButton
              label={actionLabel}
              disabled={!!problem}
              onPress={() => setPreviewOpen(true)}
            />
          </View>
        }
      />

      <ReceiptPreviewSheet
        visible={previewOpen}
        doc={doc}
        actionLabel={actionLabel}
        busy={compose.isPending || issueForPayment.isPending || updateReceipt.isPending}
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
