// АНАЛИТИКА — ЧИСТЫЕ РАСЧЁТЫ: по количеству предоставленных услуг, вся градация, по всем мастерам.
//
// Два разных вопроса — два разных источника, и путать их нельзя:
//   • ДЕНЬГИ («Оплачено», «Расход», «Прибыль») — из журнала операций, тем же
//     правилом, что плитки «Финансов»: доход и возвраты со знаком, расход
//     операциями плюс материалы выполненных записей. Цифра сходится с
//     «Финансами» пальцем.
//   • РАБОТА («Работ на», услуги, записи, часы) — из выполненных записей:
//     что сделали, сколько штук, на какую сумму по прайсу записи.
// Выполненная запись — рабочая (не событие), не отменённая, и либо уже
// «выполнена», либо её день прошёл. Будущие записи — план, не сделанное.
//
// Public surface; the pieces live in `./analytics-math/`.

export {
  cancelledCount,
  isPerformed,
  ledgerInScope,
  performedRecords,
  recordMinutes,
  upcomingRecords,
  type Scope,
} from "./analytics-math/scope";
export {
  materialTotals,
  moneyTotals,
  serviceBreakdown,
  workTotals,
  type MoneyTotals,
  type ServiceRow,
  type WorkTotals,
} from "./analytics-math/totals";
export {
  changePct,
  changeText,
  monthTable,
  previousPeriod,
  yearMonths,
  type MonthRow,
} from "./analytics-math/periods";
export {
  accountBreakdown,
  clientBreakdown,
  hoursLabel,
  serviceProfit,
  teamBreakdown,
  weekdayLoad,
  type AccountRow,
  type ClientRow,
  type ServiceProfitRow,
  type TeamRow,
  type WeekdayRow,
} from "./analytics-math/breakdowns";
