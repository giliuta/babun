import { useEffect, useMemo, useRef, useState } from "react";
import { parseMoneyInputToCents } from "@babun/shared/common/utils/money";
import type { AccountWithBalance } from "../accounts";
import { defaultTransferTarget } from "../transfer-options";
import { loadLastTransferTarget } from "../transfer-memory";
import {
  amountForNewSource,
  transferOpening,
  type TransferOpened,
  type TransferStep,
} from "./transfer-rules";

/** The transfer form's own state, the reset on every opening, and the three
 *  ways the person changes the pair: pick a source, pick a target, swap. */
export function useTransferDraft({
  visible,
  accounts,
  presetFromId,
  presetToId,
  presetAmount,
  businessToday,
}: {
  visible: boolean;
  accounts: AccountWithBalance[];
  presetFromId: string | null | undefined;
  presetToId: string | null | undefined;
  presetAmount: number | null | undefined;
  businessToday: string;
}) {
  const [step, setStep] = useState<TransferStep>("form");
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  /** День перевода. Стартует бизнес-сегодня; вперёд не уходит — деньги нельзя
   *  передать завтра (`rejectFutureLedgerDate` откажет ещё до сети). */
  const [occurredOn, setOccurredOn] = useState(businessToday);
  /** Крутится в барабане, пока шаг открыт. Отдельно от `occurredOn`, чтобы уход
   *  «Назад» не менял дату перевода — как и в любом другом выборе листа. */
  const [dateDraft, setDateDraft] = useState(businessToday);
  /** Пришли со строки счёта — источником ошибиться физически невозможно.
   *  Снимается «Поменять местами»: после разворота источник уже другой. */
  const [sourceLocked, setSourceLocked] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const byId = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts],
  );
  const from = fromId ? (byId.get(fromId) ?? null) : null;
  const to = toId ? (byId.get(toId) ?? null) : null;
  const amountCents = parseMoneyInputToCents(amount);

  // Каждое ОТКРЫТИЕ листа начинает заново, но только по фронту: фоновый
  // рефетч счетов при открытом листе не должен стирать набранное.
  const wasVisible = useRef(false);
  /** Что лист показал при открытии (`TransferOpened`). */
  const opened = useRef<TransferOpened | null>(null);
  useEffect(() => {
    if (!visible) {
      wasVisible.current = false;
      return;
    }
    if (wasVisible.current) return;
    wasVisible.current = true;
    const start = transferOpening({
      accounts,
      presetFromId,
      presetToId,
      presetAmount,
      businessToday,
      remembered: loadLastTransferTarget,
    });
    opened.current = start.opened;
    setStep(start.step);
    setFromId(start.fromId);
    setSourceLocked(start.sourceLocked);
    setToId(start.toId);
    setAmount(start.amount);
    setNote("");
    setOccurredOn(businessToday);
    setFailure(null);
  }, [visible, presetFromId, presetToId, presetAmount, accounts, businessToday]);

  // СБРОСА ПОЛУЧАТЕЛЯ БОЛЬШЕ НЕТ. Он был нужен, пока существовал запрет
  // «между командами только через общий счёт»: смена источника могла сделать
  // выбранного получателя недопустимым. Запрета нет (владелец 2026-08-15), а
  // единственную оставшуюся коллизию — выбрать источником текущего получателя
  // — список теперь не допускает вовсе.
  const pickFrom = (id: string | null) => {
    setFromId(id);
    // «Сдать всё — ноль набора» работает из ЛЮБОЙ двери: пока сумму не правили
    // руками (пусто либо ровно остаток прежнего источника), её заполняет весь
    // остаток нового — как при открытии со строки счёта. Набранную руками
    // цифру смена источника не трогает.
    const next = id ? (byId.get(id) ?? null) : null;
    const refill = amountForNewSource(amountCents, from, next);
    if (refill !== null) setAmount(refill);
    // ПОЛУЧАТЕЛЬ ПОДСТАВЛЯЕТСЯ ТЕМ ЖЕ ПРАВИЛОМ, ЧТО И ПРИ ВХОДЕ СО СТРОКИ:
    // прошлый адресат этого источника, а если счёт в паре всего один — он.
    // Уже выбранного рукой получателя не трогаем: смена источника — не повод
    // переигрывать чужое решение.
    let target = to;
    if (next && !target) {
      target = defaultTransferTarget({
        accounts,
        from: next,
        remembered: loadLastTransferTarget(next.id),
      });
      setToId(target?.id ?? null);
    }
    // Подставить нечего — спрашиваем сразу, а не показываем форму с погашенной
    // кнопкой и надписью «Выберите, куда».
    setStep(target ? "form" : "to");
    setFailure(null);
  };

  const pickTo = (id: string | null) => {
    setToId(id);
    setStep("form");
    setFailure(null);
  };

  const swap = () => {
    if (!from || !to) return;
    setFromId(to.id);
    setToId(from.id);
    // Источник больше не «тот, со строки которого пришли».
    setSourceLocked(false);
    setFailure(null);
  };

  return {
    step,
    setStep,
    fromId,
    toId,
    amount,
    setAmount,
    amountCents,
    note,
    setNote,
    occurredOn,
    setOccurredOn,
    dateDraft,
    setDateDraft,
    sourceLocked,
    failure,
    setFailure,
    sending,
    setSending,
    from,
    to,
    opened,
    pickFrom,
    pickTo,
    swap,
  };
}
