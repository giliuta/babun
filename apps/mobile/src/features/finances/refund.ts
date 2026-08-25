import { randomUuid } from "@babun/shared/sync";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import type { TransactionDraft } from "@babun/shared/db/repositories/finance-transactions";

// Кап возврата: сколько от дохода ЕЩЁ можно вернуть.
//
// Деньги сравниваются ТОЛЬКО в центах: float-вычитание (10 − 1.12 =
// 8.879999…) уже ломало префилл и запрещало вернуть ровно остаток. Регрессия
// случалась внутри JSX-компонента, где её нечем накрыть, — поэтому расчёт
// живёт чистой функцией под тестом (refund.test.ts), а попап только читает.

/**
 * Остаток дохода, доступный к возврату, в ЦЕНТАХ. Отрицательным не бывает:
 * перевозвращённый доход — это «возвращать больше нечего», а не минус.
 *
 * `alreadyRefunded === Infinity` — легальный вход: пока Σ возвратов грузится,
 * экран передаёт бесконечность и получает 0 — «Создать возврат» консервативно
 * прячется, потому что завысить кап хуже, чем задержать кнопку.
 */
export function refundRemainingCents(
  amount: number,
  alreadyRefunded: number,
): number {
  return Math.max(
    0,
    Math.round(amount * 100) - Math.round(alreadyRefunded * 100),
  );
}

/**
 * Драфт возврата по доходу — ОДИН на продукт: «Финансы» и карточка счёта
 * держали две дословные копии, и правило возврата приходилось чинить дважды.
 *
 * Возврат — отрицательная строка, привязанная к доходу через `refund_of_id`
 * и наследующая его счёт/команду/категорию/способ: деньги уходят из того же
 * кармана, куда пришли.
 */
export function buildRefundDraft(
  tx: FinanceTransaction,
  amount: number,
  businessToday: string,
): TransactionDraft {
  return {
    type: "refund",
    amount: -Math.abs(amount),
    account_id: tx.account_id,
    team_id: tx.team_id,
    category_id: tx.category_id,
    payment_method: tx.payment_method,
    // НДС — снимок ИСХОДНОГО дохода, а не сегодняшние настройки счёта: без
    // явного режима триггер шёл в настройки «счёт → команда → компания» и
    // навешивал на возврат налог, которого не собирали (или по сменившейся
    // ставке). Сервер с 2026-08-16 наследует снимок сам по `refund_of_id`,
    // но явная передача дешева и не даёт разъехаться офлайн-очереди.
    vat_mode: tx.vat_mode ?? (tx.vat_amount ? "inclusive" : "none"),
    refund_of_id: tx.id,
    invoice_id: tx.invoice_id,
    occurred_on: businessToday,
    business_today: businessToday,
    notes: `Возврат по операции от ${tx.occurred_on}`,
    // Стабильный PK попытки: ретрай после потерянного ответа упирается в
    // duplicate key и трактуется как успех — возврат не задваивается
    // (паттерн request_id операций и переводов).
    request_id: randomUuid(),
  };
}
