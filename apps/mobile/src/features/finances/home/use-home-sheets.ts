import { useCallback, useState } from "react";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import type { Debt, DebtDirection } from "@babun/shared/local/finance/debt";
import type { DocumentFilter } from "../documents";

export interface DebtPayment {
  debtId: string;
  counterparty: string;
  amount: number;
  clientId: string | null;
  direction: DebtDirection;
  /** Команда долга: платёж ложится на её счёт, какой бы чип ни был выбран. */
  teamId: string | null;
}

/** Open-state of the screen's sheets and the two panel switches whose value
 *  the footer button needs (documents tab, debts side). */
export function useHomeSheets() {
  // Вид документа живёт ЗДЕСЬ, а не внутри панели: от него зависит главная
  // кнопка внизу экрана, а она снаружи. Инвойсы первыми — это единственный
  // документ, который выписывают руками.
  const [docFilter, setDocFilter] = useState<DocumentFilter>("invoice");
  const [opOpen, setOpOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<FinanceTransaction | null>(null);
  const [popupTx, setPopupTx] = useState<FinanceTransaction | null>(null);
  // Какую сторону долгов смотрим и какой долг правим. Живут ЗДЕСЬ, а не в
  // панели: от стороны зависит подпись главной кнопки внизу экрана, а она
  // снаружи панели (тот же довод, что у `docFilter`).
  const [debtSide, setDebtSide] = useState<DebtDirection>("incoming");
  const [debtOpen, setDebtOpen] = useState(false);
  const [firstAccountOpen, setFirstAccountOpen] = useState(false);
  const [editingDebt, setEditingDebt] = useState<Debt | null>(null);
  // Платёж по долгу открывает ТУ ЖЕ форму операции, что и всё остальное:
  // движение денег в продукте одно, и второй его формы быть не должно.
  const reopenDebtSheet = useCallback(() => setDebtOpen(true), []);
  const [debtPayment, setDebtPayment] = useState<DebtPayment | null>(null);
  return {
    docFilter,
    setDocFilter,
    opOpen,
    setOpOpen,
    editingTx,
    setEditingTx,
    popupTx,
    setPopupTx,
    debtSide,
    setDebtSide,
    debtOpen,
    setDebtOpen,
    firstAccountOpen,
    setFirstAccountOpen,
    editingDebt,
    setEditingDebt,
    reopenDebtSheet,
    debtPayment,
    setDebtPayment,
  };
}

export type HomeSheetsState = ReturnType<typeof useHomeSheets>;
