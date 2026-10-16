// Pure gates of the operation form: refund guards, whether the button is
// live, and the one reason printed under it. No React here — the sheet feeds
// plain values and gets plain answers back.

import { formatEURExact as formatEUR, moneyInputProblem } from "@babun/shared/common/utils/money";

/** Финансы онлайн-only НА ЗАПИСЬ (ТЗ §8): без сети кнопка гасится и называет
 *  причину. Крутящаяся кнопка страшнее отказа — по ней не понять, записалась
 *  операция или нет, а свёрнутое приложение унесло бы намерение молча. */
export const OFFLINE_OPERATION =
  "Без сети операция не записывается. Оформите её, когда появится связь.";

/** Команду в самом листе выбрать нечем — она приезжает с экрана финансов.
 *  Раньше подсказка отсылала «наверх экрана», которого под модальным листом
 *  не видно: совет обязан быть выполнимым. */
export const NO_TEAM_REASON =
  "Закройте форму и выберите команду чипом на экране финансов — без команды операция не запишется.";

/** Операция закрытого счёта: сервер не принимает НИ правку, НИ удаление,
 *  пока счёт не открыт снова. Совет «выберите счёт заново» здесь невыполним,
 *  поэтому причина и единственный выход названы честно. */
export const CLOSED_ACCOUNT_REASON =
  "Счёт этой операции закрыт. Изменить или удалить её можно, когда счёт снова открыт.";

/** Уровень «Смотрит» в деньгах этого календаря: форму открыли прочитать.
 *  Причина названа до нажатия — серая кнопка без слов читается как поломка. */
export const READ_ONLY_REASON =
  "Только просмотр — записывать операции в этом календаре вам нельзя.";

export interface RefundGuards {
  refundsKnown: boolean;
  belowRefunded: boolean;
  refundHoldsAccount: boolean;
  lowersWhileRefundsUnknown: boolean;
}

export function refundGuards({
  isEdit,
  type,
  amountCents,
  gross,
  refundedTotal,
  txAmount,
}: {
  isEdit: boolean;
  type: "income" | "expense";
  amountCents: number | null;
  /** Gross of the amount on screen (`applyTxVat(...).gross`). */
  gross: number;
  refundedTotal: number;
  /** Amount of the edited transaction; `null` for a new one. */
  txAmount: number | null;
}): RefundGuards {
  // Возвраты сравниваются В ЦЕНТАХ: float-вычитание ломает ровные границы.
  // Доход нельзя опустить ниже уже возвращённого — иначе возвраты по нему
  // превысили бы сам доход (сервер это тоже отбивает, но причину человек
  // должен прочитать до нажатия).
  //
  // Σ ВОЗВРАТОВ ЕЩЁ НЕ ИЗВЕСТНА (страница подставляет Infinity, пока запрос
  // едет или упал). Прежде это значило «ниже возвращённого» для ЛЮБОГО
  // дохода: правка гасла целиком, а причина печатала «возвращено €∞»
  //. Неизвестно — значит, нельзя только УМЕНЬШИТЬ сумму:
  // заметка, категория и сумма вверх возвратам не грозят.
  const refundsKnown = Number.isFinite(refundedTotal);
  const belowRefunded =
    isEdit &&
    type === "income" &&
    amountCents != null &&
    refundsKnown &&
    Math.round(refundedTotal * 100) > 0 &&
    Math.round(gross * 100) < Math.round(refundedTotal * 100);
  // ДОХОД С ВОЗВРАТОМ ДЕРЖИТ СВОЙ СЧЁТ. Возврат лежит на
  // счёте дохода, а сервер смену счёта у такого дохода не останавливает:
  // доход уезжал на «Карту», возврат оставался в «Наличных» — касса в минусе,
  // правило «возврат — по исходному счёту» нарушено. Пока возвраты не
  // загрузились — тоже не меняем: неизвестно, есть ли они.
  const refundHoldsAccount =
    isEdit && type === "income" && (!refundsKnown || refundedTotal > 0);
  const lowersWhileRefundsUnknown =
    isEdit &&
    type === "income" &&
    amountCents != null &&
    !refundsKnown &&
    txAmount != null &&
    Math.round(gross * 100) < Math.round(Math.abs(txAmount) * 100);
  return { refundsKnown, belowRefunded, refundHoldsAccount, lowersWhileRefundsUnknown };
}

export interface OperationGateInput {
  online: boolean;
  accountsFailed: boolean;
  txAccountClosed: boolean;
  amount: string;
  amountCents: number | null;
  refundedTotal: number;
  belowRefunded: boolean;
  lowersWhileRefundsUnknown: boolean;
  dateInFuture: boolean;
  accountMismatch: boolean;
  teamId: string | null;
  teamAccountsCount: number;
  accountId: string | null;
  categoryId: string | null;
  receiptMissing: boolean;
  categoryName: string | undefined;
}

export function operationCanSave(
  g: OperationGateInput & { canWrite: boolean; busy: boolean },
): boolean {
  return (
    g.canWrite &&
    !g.receiptMissing &&
    g.amountCents != null &&
    // КАТЕГОРИЯ ОБЯЗАТЕЛЬНА: деньги без категории выпадают из разбивки. Снятия
    // повторным тапом у категории нет и не заводим: у типа
    // события оно законно (событие без типа существует и называется
    // «Событие»), а расход без категории врёт «Прибыли».
    !!g.categoryId &&
    !!g.teamId &&
    !!g.accountId &&
    !g.accountMismatch &&
    !g.dateInFuture &&
    !g.belowRefunded &&
    !g.lowersWhileRefundsUnknown &&
    !g.txAccountClosed &&
    // Финансы онлайн-only НА ЗАПИСЬ (ТЗ §8): без сети кнопка гасится и
    // объясняет себя строкой ниже. Крутящаяся кнопка страшнее отказа —
    // человек не знает, записалась операция или нет.
    g.online &&
    !g.busy
  );
}

export type OperationReason = { text: string; error: boolean } | null;

/** Причина погашенной кнопки — ровно одна и самая важная. Офлайн и
 *  закрытый счёт — закрытые двери (нейтральный цвет), остальное — ошибки
 *  ввода. */
export function operationInputReason(g: OperationGateInput): OperationReason {
  return !g.online
    ? { text: OFFLINE_OPERATION, error: false }
    : g.accountsFailed
      ? {
          text: "Не удалось загрузить счета. Закройте лист и откройте заново",
          error: true,
        }
      : g.txAccountClosed
        ? { text: CLOSED_ACCOUNT_REASON, error: false }
        : g.amount.length > 0 && g.amountCents == null
          ? {
              text:
                moneyInputProblem(g.amount) ??
                "Введите сумму больше нуля и не больше двух знаков после запятой",
              error: true,
            }
          : g.belowRefunded
            ? {
                text: `По этому доходу уже возвращено ${formatEUR(g.refundedTotal)} — сумма не может стать меньше возвращённого`,
                error: true,
              }
            : g.lowersWhileRefundsUnknown
              ? {
                  text: "Возвраты по доходу ещё загружаются — уменьшить сумму можно после",
                  error: false,
                }
            : g.dateInFuture
              ? {
                  text: "Финансовую операцию нельзя записать будущей датой",
                  error: true,
                }
              : g.accountMismatch
                ? {
                    text: "Сохранённый счёт не подходит. Выберите доступный счёт заново",
                    error: true,
                  }
                : g.teamId && g.teamAccountsCount === 0
                  ? {
                      text: "У этой команды нет активного счёта — заведите его в «Счетах»",
                      error: true,
                    }
                  // ПУСТАЯ СУММА ТОЖЕ НАЗЫВАЕТ СЕБЯ. Раньше все причины ниже
                  // были заперты за `amountCents != null`, и до первой цифры
                  // лист открывался с погашенной кнопкой и НИ ОДНИМ словом
                  // рядом — серая кнопка без объяснения читается как поломка
                  // продукта (тот же закон, по которому лист перевода печатает
                  // причину всегда, а не после первого символа). Это не ошибка
                  // ввода, а незаполненное поле, поэтому цвет нейтральный.
                  : g.amountCents == null
                    ? { text: "Введите сумму операции", error: false }
                    : g.amountCents != null && !g.teamId
                    ? { text: NO_TEAM_REASON, error: true }
                    : g.amountCents != null && !g.accountId
                      ? {
                          text: "Выберите счёт, на который записать операцию",
                          error: true,
                        }
                      : g.amountCents != null && !g.categoryId
                        ? {
                            text: "Выберите категорию операции",
                            error: true,
                          }
                        : g.receiptMissing
                          ? {
                              text: `Для категории «${g.categoryName ?? ""}» нужно фото чека`,
                              error: true,
                            }
                          : null;
}

/** ТОЛЬКО ПРОСМОТР СИЛЬНЕЕ ПРИЧИН ВВОДА: заполнять форму дальше незачем,
 *  если записать её этому человеку всё равно нельзя. */
export function operationReason(
  canWrite: boolean,
  inputReason: OperationReason,
): OperationReason {
  return canWrite ? inputReason : { text: READ_ONLY_REASON, error: false };
}
