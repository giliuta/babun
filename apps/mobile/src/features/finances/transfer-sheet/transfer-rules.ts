// Pure rules of the transfer sheet: how it opens, why the button is grey,
// when closing must ask, how far back the date goes. No React here.

import {
  formatMoneyForInput,
  money,
  moneySign,
} from "@babun/shared/common/utils/money";
import { transferValidationError } from "@babun/shared/local/finance/integrity";
import { formatYMD, parseYMD } from "@/features/appointments/helpers";
import { accountDaysOnHand } from "../accounts-sections";
import { dayPhrase } from "@/lib/period";
import { defaultTransferTarget, type TransferAccount } from "../transfer-options";

export type TransferStep = "form" | "from" | "to" | "date";

/** Финансы онлайн-only НА ЗАПИСЬ (ТЗ §8): без сети кнопка гасится и говорит
 *  почему. Крутящаяся кнопка на этом месте страшнее ошибки — человек не знает,
 *  ушли деньги или нет. */
export const OFFLINE_REASON =
  "Без сети перевод не проводится. "
  + "Передайте деньги и оформите, когда появится связь.";

/** Связь пропала МЕЖДУ нажатием и ответом. Повтор безопасен: `request_id`
 *  привязан к намерению, и сервер отдаст тот же перевод, а не второй. */
export const OFFLINE_MID_FLIGHT =
  "Связь пропала. Нажмите ещё раз, когда появится сеть — перевод не задвоится.";

/** Что лист показал при открытии: смахнуть его без вопроса можно, пока
 *  набранное с этим совпадает. */
export interface TransferOpened {
  from: string | null;
  to: string | null;
  amount: string;
  on: string;
}

interface TransferOpening {
  step: TransferStep;
  fromId: string | null;
  toId: string | null;
  sourceLocked: boolean;
  amount: string;
  opened: TransferOpened;
}

/** Where a freshly opened sheet starts. `remembered` reads the last target
 *  of a source (`transfer-memory.ts`). */
export function transferOpening<T extends TransferAccount>({
  accounts,
  presetFromId,
  presetToId,
  presetAmount,
  businessToday,
  remembered,
}: {
  accounts: T[];
  presetFromId: string | null | undefined;
  presetToId: string | null | undefined;
  presetAmount: number | null | undefined;
  businessToday: string;
  remembered: (fromId: string) => string | null;
}): TransferOpening {
  const source = presetFromId ? (accounts.find((a) => a.id === presetFromId) ?? null) : null;
  const preselected = presetToId
    ? (accounts.find((a) => a.id === presetToId) ?? null)
    : null;
  // ПОЛУЧАТЕЛЬ НАЗВАН СНАРУЖИ — источник тогда ищем сами: это самый полный
  // счёт из остальных, то есть тот, с которого перевод вообще возможен.
  const donor =
    !source && preselected
      ? (accounts
          .filter((a) => a.id !== preselected.id && a.balance > 0)
          .sort((a, b) => b.balance - a.balance)[0] ?? null)
      : null;
  const target = preselected
    ? preselected
    : source
      ? defaultTransferTarget({
          accounts,
          from: source,
          remembered: remembered(source.id),
        })
      : null;
  const preset = presetAmount ?? source?.balance ?? 0;
  // ЛИСТ ОТКРЫВАЕТСЯ НА ПЕРВОМ НЕОТВЕЧЕННОМ ВОПРОСЕ (тапов как можно меньше). Со строки счёта
  // источник известен — значит,
  // сразу форма с набранной суммой. Иконкой ⇄ из шапки не известно ничего, и
  // форма встречала двумя «Выберите счёт» и цифровой клавиатурой под пустой
  // суммой: три лишних тапа, чтобы добраться до единственного вопроса,
  // который вообще можно задать первым.
  const startAmount = moneySign(preset) > 0 ? formatMoneyForInput(preset) : "";
  return {
    step: source || donor ? "form" : "from",
    fromId: source?.id ?? donor?.id ?? null,
    toId: target?.id ?? null,
    sourceLocked: !!source,
    amount: startAmount,
    opened: {
      from: source?.id ?? donor?.id ?? null,
      to: target?.id ?? null,
      amount: startAmount,
      on: businessToday,
    },
  };
}

/** «Сдать всё» работает из ЛЮБОЙ двери: пока сумму не правили руками (пусто
 *  либо ровно остаток прежнего источника), её заполняет весь остаток нового.
 *  `null` — набранную руками цифру не трогаем. */
export function amountForNewSource(
  amountCents: number | null,
  from: { balance: number } | null,
  next: { balance: number } | null,
): string | null {
  const untouched =
    amountCents === null ||
    (from !== null && amountCents === Math.round(from.balance * 100));
  if (next && untouched) {
    return moneySign(next.balance) > 0 ? formatMoneyForInput(next.balance) : "";
  }
  return null;
}

/** ПРИЧИНА ПЕЧАТАЕТСЯ ВСЕГДА, а не после первого символа: серая кнопка без
 *  объяснения читается как поломка продукта. */
export function transferReason(
  online: boolean,
  from: TransferAccount | null,
  to: TransferAccount | null,
  amountNum: number,
): string | null {
  return !online
    ? OFFLINE_REASON
    : !from
      ? "Выберите, откуда"
      : !to
        ? "Выберите, куда"
        : transferValidationError(from, to, amountNum);
}

/** Something typed since the sheet opened. */
export function transferIsDirty(
  start: TransferOpened | null,
  now: { fromId: string | null; toId: string | null; amount: string; occurredOn: string; note: string },
): boolean {
  return (
    !!start &&
    (now.fromId !== start.from ||
      now.toId !== start.to ||
      now.amount !== start.amount ||
      now.occurredOn !== start.on ||
      now.note.trim() !== "")
  );
}

// НИЖНЯЯ ГРАНИЦА БАРАБАНА ДАТЫ: раньше первого движения денег переводить
// нечего, а у тенанта совсем без истории — начало прошлого месяца. Без пола
// случайная прокрутка колеса года молча уносила перевод в глубокое прошлое:
// сервер отбивает только будущие даты.
export function transferDateFloor(
  accounts: readonly { first_tx_on: string | null }[],
  businessToday: string,
): string {
  const firstMovement = accounts
    .map((a) => a.first_tx_on)
    .filter((d): d is string => d !== null)
    .sort()[0];
  if (firstMovement && firstMovement <= businessToday) return firstMovement;
  const today = parseYMD(businessToday);
  return formatYMD(new Date(today.getFullYear(), today.getMonth() - 1, 1));
}

// «Перевод», а не «Перевод между счетами»: другого перевода в этом листе не
// бывает, а глоссарий (§7) даёт одно слово на одну сущность. Сдача выручки —
// отдельное событие для человека, и называется своим словом.
export function transferTitle(step: TransferStep): string {
  return step === "from"
    ? "Откуда"
    : step === "to"
      ? "Куда"
      : step === "date"
        ? "Когда"
        : "Перевод";
}

// «На руках €640 · с 4 августа» — возраст остатка есть только у кассы, и
// только если движения по ней вообще были. Подпись живёт ВНУТРИ карточки
// источника, рядом с его именем.
export function transferSourceCaption(
  from: {
    kind: string;
    balance: number;
    last_outflow_on: string | null;
    first_tx_on: string | null;
  } | null,
  businessToday: string,
  currency: string | undefined,
): string | null {
  const onHandSince = from?.last_outflow_on ?? from?.first_tx_on ?? null;
  const onHandDays =
    from && onHandSince ? accountDaysOnHand(from, businessToday) : null;
  // В плашке справа — остаток; у кассы с деньгами на руках — и с какого дня.
  return !from
    ? null
    : from.kind === "cash" && onHandSince && onHandDays !== null && onHandDays > 0
      ? `${money(from.balance, currency)} · с ${dayPhrase(onHandSince)}`
      : money(from.balance, currency);
}
