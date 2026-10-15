// ОДИН ВИЗИТ — ОДНА СТРОКА: предоплата, доплата или переплата — всё это единая
// сумма, зафиксированная за этой записью.
//
// Лента операций — это лента ПРОВОДОК: визит с предоплатой и доплатой даёт в
// ней две строки, частичный возврат — третью, и в разрезе «Доход» человек
// видит одну работу трижды. Здесь проводки одного `appointment_id` сходятся в
// одну строку: клиент титулом, услуги подстрокой, сумма визита справа.
//
// Доход и расход НЕ схлопываются между собой: доход 135 стоит целиком, расход
// 10 стоит целиком, а в прибыли уже 135 − 10. Эта
// функция считает ОДИН разрез: что ей дали, то и сложила. Вычитание живёт в
// плитке «Прибыль», а не здесь.
//
// Проводка без записи (бензин, обеды, зарплата) остаётся сама собой: у неё
// нет ни клиента, ни услуг, и шаблон «клиент + услуги» сложился бы для неё с
// пустыми полями. Такая строка приходит своим видом — `appointmentId: null`.
//
// Public surface; the pieces live in `./record-rows/`.

export type { RecordRow, RecordRowRefs, RowAccount, RowExtra } from "./record-rows/types";
export { appointmentServiceNames, recordRows } from "./record-rows/build";
export {
  accountsLine,
  debtAge,
  dropAccountNames,
  paymentsLine,
  rowMatchesQuery,
  rowsNet,
  servicesLine,
  whatLine,
} from "./record-rows/lines";
export { mergeByRecord } from "./record-rows/merge";
