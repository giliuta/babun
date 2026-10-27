import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useSheetDoorway } from "@/components/ui/use-sheet-doorway";
import { useReceiptSession } from "./receipt-upload";
import { useReceiptLock } from "./operation-sheet/use-receipt-lock";
import { applyTxVat } from "@babun/shared/local/finance/vat";
import { useToast } from "@/components/ui/Toast";
import { useThemeColors } from "@/theme/colors";
import { parseMoneyInputToCents } from "@babun/shared/common/utils/money";
import { useIsOnline } from "@babun/shared/sync";
import { useMasters, useTeams } from "@/features/reference/queries";
import { asksOf, payeeOptions, pickableCategories } from "./category-asks";
import { useClientChoice } from "./use-client-choice";
import type { Client } from "@babun/shared/local/clients";
import {
  useFinanceCategories,
  useInsertTransaction,
  useUpdateTransaction,
} from "./queries";
import { useCurrentRole } from "@/session/tenant";
import {
  minusAfterSpend, operationCanSave,
  operationInputReason,
  operationReason,
  refundGuards,
  type OperationGateInput,
} from "./operation-sheet/operation-guards";
import { OperationAccountBlock } from "./operation-sheet/OperationAccountBlock";
import { OperationAmount } from "./operation-sheet/OperationAmount";
import { OperationNoteAndFile } from "./operation-sheet/OperationNoteAndFile";
import { OperationTopBlocks } from "./operation-sheet/OperationTopBlocks";
import { OperationWhoBlocks } from "./operation-sheet/OperationWhoBlocks";
import { OperationFooter } from "./operation-sheet/OperationFooter";
import { OperationPickers } from "./operation-sheet/OperationPickers";
import type { OperationSheetProps } from "./operation-sheet/types";
import { useOperationAccounts } from "./operation-sheet/use-operation-accounts";
import { useOperationClose } from "./operation-sheet/use-operation-close";
import { useOperationDraft } from "./operation-sheet/use-operation-draft";
import { useOperationSave } from "./operation-sheet/use-operation-save";
import { useOperationVat } from "./operation-sheet/use-operation-vat";
import { amountVatMode } from "./operation-sheet/vat-frame";

export type { OperationSheetProps } from "./operation-sheet/types";

export function OperationSheet({
  visible,
  onClose,
  defaultTeamId,
  defaultAccountId,
  defaultType = "expense",
  defaultDate = null,
  businessToday,
  transaction,
  debtPayment,
  refundedTotal = 0,
  refundsFailed: refundsFailedProp = false,
  onRetryRefunds,
  canWrite: canWriteProp = true,
  canWriteType,
  fromCalendar = false,
  onExited,
}: OperationSheetProps) {
  const th = useThemeColors();
  const online = useIsOnline();
  const { data: categories = [] } = useFinanceCategories();
  const { data: teams = [] } = useTeams({ display: true });
  // ВЛАДЕЛЬЧЕСКИЕ ДВЕРИ ЭТОЙ ФОРМЫ. Сотрудник пишет только доход и расход на
  // счёт своего календаря (уровни финансов): бакет чеков,
  // справочник категорий, настройки счёта, инвойс и возврат сервер отдаёт
  // только владельцу — живой контрол над запрещённым канон не допускает.
  const isOwner = useCurrentRole().data === "owner";
  const insert = useInsertTransaction();
  const update = useUpdateTransaction();
  const toast = useToast();
  const isEdit = !!transaction;

  const draft = useOperationDraft({
    visible, transaction, debtPayment, defaultTeamId, defaultType, defaultDate,
    businessToday, canWriteType, categories, vatRowAllowed: isOwner,
  });
  const {
    businessNow, typeWritable,
    type, setType, amount, setAmount, categoryId, setCategoryId,
    teamId, accountId, setAccountId, date, setDate, time, setTime,
    notes, setNotes, receiptUrl, setReceiptUrl, masterId, setMasterId,
    clientId, setClientId, setWhenTouched, vatMode, setVatMode,
    setVatTouched, setVatRetouched, vatShown, setAccountTouched,
  } = draft;
  const canWrite = canWriteProp && (isEdit || !!debtPayment || typeWritable(type));
  // Категория выбирается ЛИСТОМ, а не лентой чипов: категорий бывает два
  // десятка, и половина ленты всегда за краем экрана.
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [payeePickerOpen, setPayeePickerOpen] = useState(false);
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  // Лист шаблонов — тот же вид выбора, что у категории.
  // Дата и время правятся ТЕМ ЖЕ листом, что у записи.
  const [whenOpen, setWhenOpen] = useState(false);

  const cats = useMemo(
    () =>
      pickableCategories(
        categories,
        type === "expense" ? "expense" : "income",
        categoryId,
        teamId,
      ),
    [categories, type, categoryId, teamId],
  );

  // С уволенными: правка старой выплаты должна показать, кому она ушла.
  const peopleQuery = useMasters({ includeInactive: true });
  const clientChoice = useClientChoice();
  // Файлы, залитые в этой форме: чистит форма, когда закрыта насовсем.
  const receiptSession = useReceiptSession();
  useEffect(() => {
    if (!visible) receiptSession.flush();
  }, [visible, receiptSession]);

  const acc = useOperationAccounts({ visible, isEdit, transaction, defaultAccountId, draft });
  const { accountsFailed, teamAccounts, txAccountClosed, payment, accountMismatch } = acc;
  const vat = useOperationVat({
    isOwner, isEdit, transaction, selectedAccount: acc.selectedAccount, draft,
  });
  const { opVatRate, vatVisible } = vat;

  const amountCents = parseMoneyInputToCents(amount);
  const amountNum = (amountCents ?? 0) / 100;
  const amountMode = amountVatMode(vatMode, vatVisible && vatShown);
  const vatBreakdown = applyTxVat(amountNum, amountMode, opVatRate);
  const { refundsKnown, belowRefunded, refundHoldsAccount, lowersWhileRefundsUnknown } =
    refundGuards({
      isEdit, type, amountCents, gross: vatBreakdown.gross, refundedTotal,
      txAmount: transaction ? transaction.amount : null,
    });
  const doorway = useSheetDoorway();
  const busy = insert.isPending || update.isPending;
  const dateInFuture = date > businessToday;
  // Категория говорит собой: иконка и цвет из справочника, как у типа события
  // в записи. Не выбрана — нейтральный ярлычок, а не пустое место.
  const category = categoryId
    ? categories.find((c) => c.id === categoryId) ?? null
    : null;
  // ЧТО СПРОСИТЬ, РЕШАЕТ КАТЕГОРИЯ: сотрудника, клиента,
  // фото чека — флажками в её настройках, а не по имени.
  const asks = asksOf(category);
  // Фото прикладывает владелец: хранилище чеков владельческое, у сотрудника
  // блока файла нет — требовать от него то, что он приложить не может, нельзя.
  const receiptMissing = asks.receipt && isOwner && !receiptUrl;
  // Сравнивается то, что ляжет в операцию: в поле у VAT «сверху» стоит нетто.
  const grossCents = amountCents == null ? null : Math.round(vatBreakdown.gross * 100);
  const receiptLocked = useReceiptLock({ visible, transaction, amountCents: grossCents, accountId, date });
  const gate: OperationGateInput = {
    online, accountsFailed, txAccountClosed, amount, amountCents, refundedTotal,
    belowRefunded, lowersWhileRefundsUnknown, dateInFuture, accountMismatch,
    teamId, teamAccountsCount: teamAccounts.length, accountId, categoryId,
    receiptMissing, categoryName: category?.name,
    refundsFailed: !refundsKnown && refundsFailedProp,
    // Категории заводит владелец (справочник владельческий): партнёру в команде
    // без категорий выбирать нечего, и причина должна сказать, к кому идти.
    noCategories: cats.length === 0,
    canCreateCategory: isOwner,
    debtRemainderCents: debtPayment ? Math.round(debtPayment.amount * 100) : null,
    grossCents,
    receiptLocked, minus: type === "expense" && !isEdit && grossCents != null ? minusAfterSpend(acc.selectedAccount, grossCents / 100) : null,
  };
  const canSave = operationCanSave({ ...gate, canWrite, busy });
  const isExpense = type === "expense";
  // Значок и цвет категории живут теперь в самом блоке (`CategoryBlock`) —
  // одном на долг и операцию: две копии этой развилки уже начинали расходиться.

  // ЧТО ПРИКРЕПИТЬ, РЕШАЕТ КАТЕГОРИЯ (зарплата смотрит
  // сотрудников, другая прикрепляет клиента). Блок «Кому» или «Клиент» есть
  // только у категории, которая это прикрепляет: у прочих человеку нечего
  // выбирать, и лишний блок стоял бы пустым.
  const askEmployee = asks.employee;
  const attachClient = asks.client && !debtPayment;
  const pickedClient = clientId
    ? ((clientChoice.clients as Client[]).find((c) => c.id === clientId) ?? null)
    : null;
  const payees = payeeOptions(peopleQuery.data ?? [], teamId, masterId);
  const payee = masterId
    ? (peopleQuery.data ?? []).find((m) => m.id === masterId) ?? null
    : null;

  const save = useOperationSave({
    isEdit, isOwner, transaction, debtPayment, fromCalendar, businessToday,
    refundedTotal, type, amountCents, amountNum, categoryId, teamId, accountId,
    payment, masterId, clientId, notes, date, time, receiptUrl, askEmployee,
    attachClient, vatMode, amountMode, vatTouched: draft.vatTouched,
    vatRetouched: draft.vatRetouched, vatSettingsKnown: vat.vatSettingsKnown,
    opVatRate, txAccountClosed, accountMismatch, belowRefunded,
    lowersWhileRefundsUnknown, refundsFailed: gate.refundsFailed === true,
    requestIds: draft.requestIds,
    patchBaseline: draft.patchBaseline,
    insert, update, toast, onClose,
  });

  // «УДАЛИТЬ ОПЕРАЦИЮ» В ЛИСТЕ НЕТ: удаление — не кнопка внизу. Операцию, заведённую руками, удаляют
  // свайпом влево по её строке в ленте «Финансов» и в листе дня
  // (`features/finances/operation-delete.ts`), как счета и клиентов.

  const { askingClose, guardedClose, runAfterExit, dirty } = useOperationClose({
    busy, onClose, onExited, draft, vatRate: opVatRate,
  });
  // ПРАВКА БЕЗ ПРАВОК НЕ СОХРАНЯЕТСЯ: «Сохранить» серая, пока в операции
  // ничего не поменяли, — как «Применить» у листа счёта. Команда в снимок
  // формы не входит, её сверяем со строкой отдельно.
  const unchangedEdit = isEdit && !dirty && teamId === (transaction?.team_id ?? null);

  const reason = operationReason(canWrite, operationInputReason(gate));

  return (
    <BottomSheet
      padded={false}
      visible={visible && !doorway.parked && !askingClose}
      onClose={() => guardedClose()}
      // ДВА ХОЗЯИНА У ОДНОГО СОБЫТИЯ, И ЗВАТЬ ИХ ВМЕСТЕ НЕЛЬЗЯ.
      // Своё отложенное — это вопрос об удалении, ЧУЖОЕ — возврат
      // шторки дня. Открытые в один кадр, они дают iOS «already presenting», и
      // вопрос не появляется вовсе: тот же баг, что у «Удалить
      // операцию». Поэтому свой вопрос имеет приоритет, а шторка дня
      // возвращается только когда спрашивать нечего.
      //
      // СЛЕДСТВИЕ, КОТОРОЕ НАДО РЕШИТЬ ХОЗЯИНУ ШТОРКИ ДНЯ: после удаления
      // операции день сам не открывается. Здесь это выбрано как меньшее зло —
      // молчащая кнопка удаления хуже незакрывшегося круга.
      onExited={() => {
        if (!runAfterExit()) onExited?.();
      }}
      title={
        debtPayment ? "Оплата долга" : isEdit ? "Операция" : "Новая операция"
      }
      // Команда не выбирается — она приехала чипом с экрана финансов. Строкой
      // поля она выглядела нажимаемой; здесь она просто подписана.
      subtitle={
        teamId ? (teams.find((t) => t.id === teamId)?.name ?? undefined) : "Компания"
      }
      scroll
      avoidKeyboard
      maxHeightRatio={0.86}
      footer={
        <OperationFooter
          reason={reason}
          label={
            debtPayment
              ? "Записать оплату"
              : isEdit
                ? "Сохранить"
                : isExpense
                  ? "Добавить расход"
                  : "Добавить доход"
          }
          onSave={save}
          canSave={canSave && !unchangedEdit}
          busy={busy}
          onRetry={onRetryRefunds}
        />
      }
    >
      <View style={{ backgroundColor: th.canvas, paddingBottom: 24 }}>
        {/* ПОРЯДОК ПОЛЕЙ — КАК ЧЕЛОВЕК ДУМАЕТ:
            расход/доход → команда и дата → категория → сумма → счёт →
            заметка → документ. Компактно: каждая строка ровно на своё
            содержимое, лист не растянут на весь экран.

            Полосы шаблонов здесь больше нет: она первой встречала на
            экране создания и занимала место под то, чем пользуются раз в
            месяц. Шаблоны живут в настройках финансов. */}

        <OperationTopBlocks
          type={type}
          onTypeChange={(seg) => {
            setType(seg);
            setCategoryId(null);
          }}
          typeLocked={
            isEdit ||
            !!debtPayment ||
            !(typeWritable("income") && typeWritable("expense"))
          }
          date={date}
          whenTime={time ?? businessNow().hm}
          onOpenWhen={() => {
            if (time == null) setTime(businessNow().hm);
            setWhenOpen(true);
          }}
          category={category ?? null}
          onOpenCategory={() => setCategoryPickerOpen(true)}
        />

        <OperationWhoBlocks
          askEmployee={askEmployee}
          isExpense={isExpense}
          payee={payee}
          onOpenPayee={() => setPayeePickerOpen(true)}
          attachClient={attachClient}
          pickedClient={pickedClient}
          clientChoice={clientChoice}
          onOpenClient={() => setClientPickerOpen(true)}
        />

        {/* КЛАВИАТУРА НЕ ПОДНИМАЕТСЯ САМА: «добавить доход» не должно сразу
            переключаться на клавиатуру. Автофокус на сумме закрывал бы половину формы ещё до
            того, как человек посмотрел на неё: категория, счёт и заметка
            уезжали под клавиатуру, и первым делом приходилось её убирать. */}
        <OperationAmount
          amount={amount}
          onAmountChange={setAmount}
          vatVisible={vatVisible}
          vatShown={vatShown}
          onToggleVat={() => {
            if (vatShown) vat.closeVat();
            else vat.openVat();
          }}
          gross={vatBreakdown.gross}
          vatMode={vatMode}
          vatRate={opVatRate}
          vatAmount={vatBreakdown.vat}
          onVatModeChange={(next) => {
            setVatTouched(true);
            setVatRetouched(true);
            setVatMode(next);
          }}
          onVatRateChange={(next) => {
            vat.rememberedVat.remember(next);
            setVatTouched(true);
            setVatRetouched(true);
          }}
        />

        <OperationAccountBlock
          accountsFailed={accountsFailed}
          teamAccounts={teamAccounts}
          teamId={teamId}
          accountId={accountId}
          busy={busy}
          refundHoldsAccount={refundHoldsAccount}
          refundsKnown={refundsKnown}
          refundsFailed={gate.refundsFailed}
          txAccountId={transaction?.account_id}
          onPick={(id) => {
            setAccountTouched(true);
            setAccountId(id);
          }}
        />

        <OperationNoteAndFile
          notes={notes}
          onNotesChange={setNotes}
          showFile={isOwner}
          receiptAsked={asks.receipt}
          receiptUrl={receiptUrl}
          onReceiptPick={setReceiptUrl}
          fileDisabled={busy || !canWrite}
          session={receiptSession}
        />
      </View>

      <OperationPickers
        type={type}
        teamId={teamId}
        isOwner={isOwner}
        doorway={doorway}
        when={{
          open: whenOpen,
          onClose: () => setWhenOpen(false),
          date,
          timeStart: time ?? businessNow().hm,
          timeEnd: time ?? businessNow().hm,
          onCommit: (next) => {
            setDate(next.date);
            setTime(next.timeStart);
            setWhenTouched(true);
          },
        }}
        category={{
          open: categoryPickerOpen,
          onClose: () => setCategoryPickerOpen(false),
          items: cats,
          selectedId: categoryId,
          onPick: (id) => setCategoryId(id),
        }}
        client={{
          open: clientPickerOpen,
          onClose: () => setClientPickerOpen(false),
          choice: clientChoice,
          selectedId: clientId,
          onPick: (id) => {
            setClientId(id);
            setClientPickerOpen(false);
          },
        }}
        payee={{
          open: payeePickerOpen,
          onClose: () => setPayeePickerOpen(false),
          items: payees,
          selectedId: masterId,
          onPick: (id) => setMasterId(id),
        }}
      />
    </BottomSheet>
  );
}
