import type { OperationType } from "./types";

// С КАКОЙ СТОРОНЫ ДЕНЕГ ОТКРЫВАЕТСЯ НОВАЯ ОПЕРАЦИЯ.
//
// Обычная операция открывается на стороне, которую человек может завести:
// «только расходы» не встречает доходом с погашенной кнопкой.
//
// ОПЛАТА ДОЛГА — НЕ ВЫБОР СТОРОНЫ. Долг «мне должны» гасится доходом, «я
// должен» — расходом, и сервер другой стороны не примет («Этот долг гасится
// доходом»). Право на неё — «Долги · Принимает оплату», а не права доходов и
// расходов; переключатель вида у оплаты долга заперт. Поэтому сторона долга
// остаётся как есть, даже если человек не может завести такую сторону
// обычной операцией.
export function operationStartType(input: {
  defaultType: OperationType;
  debtPayment: boolean;
  typeWritable: (type: OperationType) => boolean;
}): OperationType {
  const { defaultType, debtPayment, typeWritable } = input;
  if (debtPayment) return defaultType;
  const otherType: OperationType = defaultType === "income" ? "expense" : "income";
  return !typeWritable(defaultType) && typeWritable(otherType) ? otherType : defaultType;
}
