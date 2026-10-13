import { useRef } from "react";
import { useRouter, type Href } from "expo-router";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Debt } from "@babun/shared/local/finance/debt";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { confirmThen } from "@/lib/confirm";
import { writeErrorWords } from "@/lib/connection-words";
import { haptics } from "@/lib/haptics";
import { notify } from "@/lib/notify";
import { deleteOperationAlert, deleteTransferAlert } from "../account-alerts";
import { useDeleteTransfer } from "../accounts";
import type { FinanceDocument } from "../documents";
import type { FinancePageAccess } from "../finance-page-access";
import type { HomeView } from "../FinanceOverview";
import { deletableByHand, refundBlocksDelete } from "../operation-delete";
import { useDeleteTransaction, useInsertTransaction } from "../queries";
import type { RecordRow } from "../record-rows";
import { buildRefundDraft } from "../refund";
import { documentsFilterOnOpen } from "./feed-rows";
import { appointmentHref, financeSettingsHref } from "./home-links";
import type { useFinanceRoute } from "../use-finance-route";
import type { HomeReferences } from "./use-home-references";
import type { HomeSheetsState } from "./use-home-sheets";

export interface RowActionsInput {
  sheets: HomeSheetsState;
  access: FinancePageAccess;
  view: HomeView;
  setView: ReturnType<typeof useFinanceRoute>["setView"];
  scope: string | null;
  accountId: string | null;
  appts: readonly Appointment[];
  scopedAccounts: readonly { id: string }[];
  allAccounts: HomeReferences["allAccounts"];
  liveAccounts: readonly { id: string }[] | undefined;
  debts: readonly Debt[];
  scopedTransactions: readonly FinanceTransaction[];
  allTimeFound: FinanceTransaction[] | undefined;
  refundTotals: ReadonlyMap<string, number> | undefined;
  periodDocuments: { documents: readonly Pick<FinanceDocument, "kind">[] };
  businessToday: string;
}

/** Every way out of the screen and every tap on a feed row. */
export function useRowActions(input: RowActionsInput) {
  const { sheets, access, view, setView, scope, accountId, appts, scopedAccounts, allAccounts, debts } = input;
  const { scopedTransactions, refundTotals, businessToday } = input;
  const { setEditingDebt, setDebtOpen, setEditingTx, setOpOpen, setPopupTx, docFilter, setDocFilter } = sheets;
  const router = useRouter();
  // Сверхбыстрый двойной тап по плитке пушил экран дважды.
  const lastPushRef = useRef(0);
  // ОДНА ДВЕРЬ НАРУЖУ на весь экран: панели уводят через неё же, поэтому
  // защита от двойного тапа одна и её нельзя забыть в новой панели.
  const pushOnce = (href: string) => {
    const now = Date.now();
    if (now - lastPushRef.current < 700) return;
    lastPushRef.current = now;
    router.push(href as Href);
  };
  const delTransfer = useDeleteTransfer();
  const delTx = useDeleteTransaction();
  const insertTx = useInsertTransaction();

  const toggleView = (v: HomeView) => {
    // «Документы» открываются там, где что-то есть: единственный чек месяца
    // прятался за пустой вкладкой «Инвойсы 0» (аудит 2026-09-30).
    if (v === "documents" && view !== "documents") {
      const next = documentsFilterOnOpen(input.periodDocuments.documents, docFilter);
      if (next) setDocFilter(next);
    }
    setView((prev) => (prev === v ? "all" : v));
  };

  // Real refund (web handleRefund): драфт собирает общий buildRefundDraft —
  // с наследованием НДС-снимка исходника.
  // Хаптик успеха НЕ здесь: возврат проводится только через TransactionPopup,
  // и сигналит он — второй вызов на экране давал двойную вибрацию.
  const handleRefund = async (tx: FinanceTransaction, amount: number, requestId: string) => {
    if (tx.source === "auto") {
      throw new Error("Возврат этой оплаты оформляется в связанной заявке.");
    }
    await insertTx.mutateAsync(buildRefundDraft(tx, amount, businessToday, requestId));
  };

  /**
   * Открыть заявку в календаре. Возвращает false, если её нет в загруженном
   * окне: уводить на экран, который скажет «заявка не найдена», хуже, чем
   * показать то, что у нас есть, — поэтому вызывающий откатывается к витрине
   * операции.
   */
  const openAppointment = (appointmentId: string): boolean => {
    const target = appts.find((a) => a.id === appointmentId);
    if (!target) return false;
    // Под «Счетами» дорога несёт и счёт — если его лента правда на экране:
    // иначе возврат выбрал бы счёт, которого человек не видел.
    const shownAccount =
      view === "accounts" && scopedAccounts.some((a) => a.id === accountId)
        ? accountId
        : null;
    pushOnce(appointmentHref(target, { view, account: shownAccount, team: scope }));
    return true;
  };

  // Настройки — ПОЛНОЦЕННАЯ СТРАНИЦА (закон продукта). Здесь был системный
  // Alert со списком: он не умеет показывать текущие значения, и «включён ли
  // НДС» приходилось выяснять, проваливаясь внутрь.
  const openFinanceSettings = () => pushOnce(financeSettingsHref(scope));

  // СТРОКА ЛЮБОЙ ПАНЕЛИ ВЕДЁТ В ОДНО МЕСТО — и в разрезах «Доход / Расход /
  // Долги», и в ленте счёта под «Счетами»: одна дверь на одну строку.
  // СВАЙП «УДАЛИТЬ» В ЛЕНТЕ (владелец 03.10: «удалить операцию — не кнопка
  // внизу»; «только у тех, что создаём своими руками»). Строка — одиночная
  // ручная операция (`deletableByHand`), право — то же, что у правки строки
  // и у витрины (`allow.remove` ниже): перевод и ручной возврат — владельцу.
  // Счёт операции закрыт или удалён — сервер удаление не примет, свайпа нет.
  const rowTx = (row: RecordRow): FinanceTransaction | null =>
    row.txId
      ? (scopedTransactions.find((x) => x.id === row.txId) ??
        (input.allTimeFound ?? []).find((x) => x.id === row.txId) ??
        null)
      : null;
  const liveAccountIds = new Set((input.liveAccounts ?? []).map((a) => a.id));
  const canDeleteRow = (row: RecordRow): boolean => {
    if (!row.txId || row.appointmentId || row.debtId) return false;
    const tx = rowTx(row);
    if (!tx || !deletableByHand(tx)) return false;
    if (tx.account_id && !liveAccountIds.has(tx.account_id)) return false;
    if (tx.type === "transfer" || tx.type === "refund") return access.owner;
    return access.txEditable(tx, {
      account: allAccounts.find((a) => a.id === tx.account_id) ?? null,
      debt: debts.find((d) => d.id === tx.debt_id) ?? null,
    });
  };
  const deleteRow = (row: RecordRow) => {
    const tx = rowTx(row);
    if (!tx) return;
    // Доход с возвратом сервер не удалит — причина словами до вопроса.
    if (refundBlocksDelete(tx, refundTotals ? (refundTotals.get(tx.id) ?? 0) : undefined)) {
      haptics.warning();
      notify("Удалить нельзя", "По этому доходу есть возврат — сначала удалите возврат.");
      return;
    }
    const text = tx.type === "transfer" ? deleteTransferAlert() : deleteOperationAlert();
    confirmThen(
      text.title,
      { message: text.message, confirmLabel: text.confirm, destructive: true },
      async () => {
        try {
          if (tx.type === "transfer" && tx.transfer_group_id) {
            await delTransfer.mutateAsync(tx.transfer_group_id);
          } else {
            await delTx.mutateAsync(tx.id);
          }
          haptics.success();
        } catch (e) {
          const words = writeErrorWords(e, {
            failed: "Не удалось удалить",
            notDone: "Операция не удалена",
          });
          notify(words.title, words.subtitle);
        }
      },
    );
  };

  const openDebt = (debtId: string) => {
    const found = debts.find((d) => d.id === debtId);
    if (!found) return;
    setEditingDebt(found);
    setDebtOpen(true);
  };

  const openRecordRow = (row: RecordRow) => {
    // Неоплаченный инвойс в долгах открывает сам инвойс.
    if (row.invoiceId) {
      router.push(`/invoices/${row.invoiceId}` as Href);
      return;
    }
    // ДЕНЬГИ ПО ЗАПИСИ ОТКРЫВАЮТ САМУ ЗАПИСЬ (владелец 2026-08-15).
    if (row.appointmentId && openAppointment(row.appointmentId)) return;
    // Ручной долг записи не имеет — открывается он сам.
    if (row.debtId) {
      openDebt(row.debtId);
      return;
    }
    // Одиночная операция — бензин, обед, перевод — открывается на
    // правку: другой двери к ней на экране нет. Витрина остаётся
    // тому, что править нельзя (перевод, проводка инвойса). Строка могла
    // приехать поиском за всё время — её в `scopedTransactions` (окно
    // периода) не найти, ищем и там, и там.
    const tx = rowTx(row);
    if (!tx) return;
    // ПРАВКА — ПО УРОВНЮ КАЛЕНДАРЯ САМОЙ СТРОКИ, а не выбранного чипа: у
    // сотрудника сервер отдаёт на правку только свой расход на счёте своей
    // команды. Нельзя — открывается витрина, а не форма с кнопкой в отказ.
    if (
      access.txEditable(tx, {
        account: allAccounts.find((a) => a.id === tx.account_id) ?? null,
        debt: debts.find((d) => d.id === tx.debt_id) ?? null,
      })
    ) {
      setEditingTx(tx);
      setOpOpen(true);
      return;
    }
    setPopupTx(tx);
  };

  return {
    pushOnce,
    delTransfer,
    delTx,
    toggleView,
    handleRefund,
    openFinanceSettings,
    canDeleteRow,
    deleteRow,
    openDebt,
    openRecordRow,
  };
}
