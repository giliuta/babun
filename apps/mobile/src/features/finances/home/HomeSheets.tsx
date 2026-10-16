import { useRouter } from "expo-router";
import { debtPaymentType } from "@babun/shared/local/finance/debt";
import { NO_TEAM } from "../accounts-sections";
import { DebtSheet } from "../DebtSheet";
import { OperationSheet } from "../OperationSheet";
import { PeriodPresetModal, PeriodWheelsModal } from "../PeriodSheets";
import { TransactionPopup } from "../TransactionPopup";
import { useRefundTotals } from "../queries";
import type { FinanceHome } from "./use-finance-home";

/** Сколько ждать полного ухода OperationSheet, прежде чем показать второй
 *  Modal. Лист — системный Modal `animationType="slide"` на 86% высоты: его
 *  dismiss дольше 260 мс BottomSheet, и попап, смонтированный раньше, iOS
 *  молча не показывает (тот же механизм и та же пауза, что у камеры в
 *  OperationReceiptRow). После пересадки листа на BottomSheet честной снова
 *  станет SHEET_EXIT_MS. */
const OPERATION_SHEET_EXIT_MS = 450;

/** The screen's sheets: operation popup, operation form, debt sheet and the
 *  two period pickers. */
export function HomeSheets({ home }: { home: FinanceHome }) {
  const router = useRouter();
  // Тот же запрос, что держит экран (общий ключ, второго похода в сеть нет):
  // здесь нужен только его повтор — по тапу на причину под кнопкой формы.
  const refundTotalsQuery = useRefundTotals();
  const {
    access,
    view,
    scope,
    period,
    setPeriod,
    businessNow,
    businessToday,
    allAccounts,
    allTeams,
    categories,
    people,
    debts,
    debtPaid,
    teamByIdAll,
    refundTotals,
    refundTotalsLoading,
    refundTotalsFailed,
    popupTx,
    setPopupTx,
    opOpen,
    setOpOpen,
    editingTx,
    setEditingTx,
    debtOpen,
    setDebtOpen,
    editingDebt,
    reopenDebtSheet,
    debtPayment,
    setDebtPayment,
    debtSide,
    presetOpen,
    setPresetOpen,
    wheelsOpen,
    setWheelsOpen,
    openTransactionInvoice,
    delTransfer,
    delTx,
    handleRefund,
  } = home;

  return (
    <>
      <TransactionPopup
        visible={!!popupTx}
        transaction={popupTx}
        // Подписи строки — по ВСЕМ счетам: перевод на скрытый накопительный
        // терял ноги «Откуда/Куда» и показывал одну сторону.
        accounts={allAccounts}
        teams={allTeams}
        categories={categories}
        people={people}
        // Пока Σ возвратов не загрузилась (refundTotals === undefined),
        // консервативно прячем «Создать возврат» (Infinity → остаток 0):
        // занизить кап хуже, чем задержать кнопку на долю секунды.
        alreadyRefunded={
          popupTx
            ? refundTotals
              ? refundTotals.get(popupTx.id) ?? 0
              : Number.POSITIVE_INFINITY
            : 0
        }
        refundTotalsLoading={refundTotalsLoading}
        refundTotalsError={refundTotalsFailed}
        onRetryRefundTotals={() => void refundTotalsQuery.refetch()}
        // Что этому человеку открыто: возврат и инвойс пока владельческие, а
        // удаление — ровно то же правило, что у правки строки. Отмена перевода
        // сотруднику не открывается: вторую ногу знает только сама витрина, а
        // сервер требует «Меняет» по обоим счетам.
        allow={{
          refund: access.refunds,
          invoice: access.documents,
          remove: popupTx
            ? popupTx.type === "transfer"
              ? access.owner
              : // Ошибочный ручной возврат владелец убирает сам: правкой он не
                // открывается (сумма привязана к доходу), а удалить его было
                // негде. Возврат оплаты записи или инвойса —
                // только из его двери.
                popupTx.type === "refund"
                ? access.owner && popupTx.source === "manual" && !popupTx.invoice_id
                : access.txEditable(popupTx, {
                  account: allAccounts.find((a) => a.id === popupTx.account_id) ?? null,
                  debt: debts.find((d) => d.id === popupTx.debt_id) ?? null,
                })
            : false,
        }}
        onClose={() => setPopupTx(null)}
        onInvoice={(tx) => {
          setPopupTx(null);
          openTransactionInvoice(tx);
        }}
        onClientOpen={(clientId) => {
          setPopupTx(null);
          router.push(`/clients/${clientId}`);
        }}
        onDelete={async (tx) => {
          // Перевод удаляется ТОЛЬКО целиком: обе ноги атомарно по
          // transfer_group_id (web parity) — удаление одной ноги оставило бы
          // полперевода и сломало остатки обоих счетов.
          if (tx.type === "transfer") {
            if (!tx.transfer_group_id) {
              throw new Error(
                "У перевода повреждена связь между счетами. Операция не изменена.",
              );
            }
            await delTransfer.mutateAsync(tx.transfer_group_id);
            return;
          }
          await delTx.mutateAsync(tx.id);
        }}
        onRefund={handleRefund}
      />

      <OperationSheet
        visible={opOpen}
        // editingTx НЕ обнуляется здесь: шапка мигала «Операция»→«Новая
        // операция» пока лист уезжал; открывающие пути сами ставят нужное.
        onClose={() => {
          setOpOpen(false);
          setDebtPayment(null);
        }}
        // Псевдо-скоуп «Без команды» команды не несёт: лист сам спросит.
        // Платёж по долгу — в команду САМОГО долга: под «Без команды» форма
        // иначе требовала выбрать чип, под которым этого долга уже не видно.
        defaultTeamId={debtPayment?.teamId ?? (scope === NO_TEAM ? null : scope)}
        // Разрез уже сказал направление — форма открывается им же. У платежа
        // по долгу направление решает сам долг: «мне должны» гасят доходом,
        // «я должен» — расходом.
        defaultType={
          debtPayment
            ? debtPaymentType(debtPayment.direction)
            : view === "income"
              ? "income"
              : "expense"
        }
        debtPayment={debtPayment}
        businessToday={businessToday}
        transaction={editingTx}
        // Лист знает только «можно ли писать» — правило живёт на экране:
        // правка — по строке (своя или «Правит всё»), платёж по долгу — по
        // «Долги: Принимает оплату», новая операция — по своей стороне денег в
        // выбранном календаре.
        canWrite={
          editingTx
            ? access.txEditable(editingTx, {
                account: allAccounts.find((a) => a.id === editingTx.account_id) ?? null,
                debt: debts.find((d) => d.id === editingTx.debt_id) ?? null,
              })
            : debtPayment
              ? (() => {
                  const paid = [editingDebt, ...debts].find(
                    (d) => d?.id === debtPayment.debtId,
                  );
                  return !!paid && access.debtPayable(paid);
                })()
              : access.ops === "write"
        }
        canWriteType={access.canAdd}
        // Пока Σ возвратов не приехала — та же консервативность, что у
        // попапа выше: Infinity не даёт опустить сумму ниже возвращённого.
        refundedTotal={
          editingTx
            ? refundTotals
              ? refundTotals.get(editingTx.id) ?? 0
              : Number.POSITIVE_INFINITY
            : 0
        }
        // Различаем «едет» и «упала»: на ошибке форма не обещает «загружается»,
        // а зовёт повторить.
        refundsFailed={refundTotalsFailed}
        onRetryRefunds={() => void refundTotalsQuery.refetch()}
      />

      {/* Долг — своя шторка из тех же блоков, что операция: направление,
          день, кто, категория, сумма, заметка. Счёта в ней нет нарочно — долг
          не деньги, и в момент его появления со счёта ничего не уходит.
          Сторона приезжает из переключателя панели: нажав «Я должен», человек
          заводит свой долг, а не чужой. */}
      <DebtSheet
        visible={debtOpen}
        debt={editingDebt}
        // Лист уезжает на время похода за новым клиентом — маршрут карточки
        // под окном шторки не виден — и возвращается этим.
        onReopen={reopenDebtSheet}
        paid={editingDebt ? debtPaid.get(editingDebt.id) ?? 0 : 0}
        // Долг правится по уровню СВОЕГО календаря, а гасится ещё и уровнем
        // «Доходов и расходов»: платёж — это операция журнала.
        canWrite={editingDebt ? access.debtEditable(editingDebt) : access.debts === "write"}
        onPay={(payment) => {
          // Одна шторка закрывается, следом открывается другая: два окна в
          // один кадр iOS не показывает («already presenting»).
          setDebtOpen(false);
          setEditingTx(null);
          setDebtPayment(payment);
          setTimeout(() => setOpOpen(true), OPERATION_SHEET_EXIT_MS);
        }}
        initialDirection={debtSide}
        teamId={scope === NO_TEAM ? null : scope}
        teamName={
          scope && scope !== NO_TEAM ? teamByIdAll.get(scope)?.name : undefined
        }
        onClose={() => setDebtOpen(false)}
      />

      <PeriodPresetModal
        visible={presetOpen}
        current={period}
        businessNow={businessNow}
        onClose={() => setPresetOpen(false)}
        onApply={setPeriod}
      />
      <PeriodWheelsModal
        visible={wheelsOpen}
        current={period}
        onClose={() => setWheelsOpen(false)}
        onApply={setPeriod}
      />
    </>
  );
}
