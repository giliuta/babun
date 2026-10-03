import { useEffect, useRef, useState } from "react";
import { moneySign } from "@babun/shared/common/utils/money";
import { useQueryClient } from "@tanstack/react-query";
import { SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { useToast } from "@/components/ui/Toast";
import { confirmAction } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import { useTenantId } from "@/lib/tenant";
import {
  useRestoreAccount,
  useSoftCloseAccount,
  useTrashAccount,
  type AccountWithBalance,
} from "../accounts";
import {
  accountNotEmptyAlert,
  hideAccountAlert,
  trashAccountAlert,
} from "../account-alerts";
import { freshAccounts } from "../accounts-page/fresh-accounts";
import {
  hideDecision,
  hideDecisionAfterTransfer,
  trashDecision,
  trashDecisionAfterTransfer,
  type HideDecision,
  type TrashDecision,
} from "../accounts-page/page-rules";
import { isLastOpenOfTeam } from "../close-decision";
import { stepAfterAnswer } from "./editor-logic";
import type { AlertError } from "./types";

// РАЗГОВОР О ЗАКРЫТИИ СЧЁТА ИЗ ЛИСТА.
//
// ИЗ ОТКРЫТОГО ЛИСТА СПРОСИТЬ НЕЛЬЗЯ (DS, LOCKED 2026-08-29): вопрос рисует
// хост приложения, а лист — отдельное окно `Modal`, и iOS отвечает «already
// presenting». Поэтому лист на время разговора УЕЗЖАЕТ (паркуется), вопрос
// звучит по `onExited`, перевод остатка открывается, когда уехал вопрос, а
// после перевода вопрос повторяется по свежему остатку (закрытие — один заход,
// аудит 2026-09-10). Отказ на любом шаге возвращает лист; закрыли или удалили
// — лист закрывается совсем.
//
// ДВА СЛОВА, ДВЕ ДОРОГИ (владелец 03.10): «Скрыть счёт» — серым вниз
// списка, как свайп «Скрыть»; «Удалить счёт» — в «Удалённые счета» на 30
// дней, как свайп «Удалить» и как клиенты. Обе требуют нуля на счёте: деньги
// сначала уводятся переводом.

/** Окно поверх уезжающего листа iOS не покажет — ждём конец его ухода. */
const AFTER_SHEET_MS = SHEET_EXIT_MS + 350;
/** Дольше свежих остатков не ждём: без ответа вопрос не задаётся вовсе, а не
 *  всплывает через минуту поверх другого экрана. */
const FRESH_TIMEOUT_MS = 6000;

const delay = <T,>(ms: number, value: T) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

type Decision = HideDecision | TrashDecision;
/** Ради чего разговор: «Скрыть» или «Удалить». */
type Mode = "hide" | "trash";

/** Слова вопроса. `null` — это не вопрос, а объяснение: остаток увести некуда. */
function questionText(
  target: AccountWithBalance,
  decision: Decision,
  mode: Mode,
  accounts: readonly AccountWithBalance[] = [],
) {
  // Последний открытый счёт команды — вопрос говорит, что команда останется
  // без счёта (аудит 2026-09-30).
  const last = target.is_active && isLastOpenOfTeam(target, accounts);
  if (decision.kind === "trash") {
    return trashAccountAlert(target.name, last);
  }
  if (decision.kind === "close") {
    return hideAccountAlert(target.name, last);
  }
  const text = accountNotEmptyAlert(
    target.name,
    target.balance,
    decision.kind === "transfer",
    mode === "trash" ? "Удалить" : "Скрыть",
  );
  return decision.kind === "transfer" && text.confirm
    ? { ...text, confirm: text.confirm }
    : null;
}

function explain(target: AccountWithBalance, mode: Mode) {
  const text = accountNotEmptyAlert(
    target.name,
    target.balance,
    false,
    mode === "trash" ? "Удалить" : "Скрыть",
  );
  notify(text.title, text.message);
}

export function useCloseFlow({
  onDone,
  alertError,
}: {
  /** Счёт закрыт, удалён или разговор оборвался ошибкой — лист закрывается. */
  onDone: () => void;
  alertError: AlertError;
}) {
  const qc = useQueryClient();
  const tenantId = useTenantId();
  const closeAcc = useSoftCloseAccount();
  const trashAcc = useTrashAccount();
  const restoreAcc = useRestoreAccount();
  // ТОСТ — ТОТ ЖЕ, ЧТО У СВАЙПА (живой прогон 2026-09-23): свайп «Скрыть»
  // говорил «Счёт скрыт», а кнопка листа то же действие делала молча.
  const toast = useToast();

  const [parked, setParked] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [preset, setPreset] = useState<{
    fromId: string | null;
    toId: string | null;
    /** `null` — весь остаток источника (так лист перевода решает сам). */
    amount: number | null;
  } | null>(null);
  /** Что спросить, когда лист уехал. */
  const afterExit = useRef<(() => void) | null>(null);
  /** Счета на момент тапа — чтобы вопрос знал, последний ли это счёт команды. */
  const knownAccounts = useRef<readonly AccountWithBalance[]>([]);
  /** Перевод затеян РАДИ СКРЫТИЯ ИЛИ УДАЛЕНИЯ: счёт в момент вопроса. */
  const closingFrom = useRef<{ account: AccountWithBalance; mode: Mode } | null>(null);
  // ЭКРАН МОГЛИ ПОКИНУТЬ, ПОКА ЖДАЛИ ОСТАТКИ: вопрос всплыл бы над чужим
  // экраном, а лист — над пустым местом.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const later = (ms: number, run: () => void) =>
    setTimeout(() => {
      if (mounted.current) run();
    }, ms);
  /** Лист возвращается, когда уехал вопрос. */
  const returnSheet = () => later(AFTER_SHEET_MS, () => setParked(false));
  const finish = () => {
    setParked(false);
    onDone();
  };
  const fail = (title: string) => (e: unknown) => {
    finish();
    alertError(title)(e);
  };

  const ask = (target: AccountWithBalance, decision: Decision, mode: Mode) => {
    const text = questionText(target, decision, mode, knownAccounts.current);
    if (!text) {
      // Лист уже уехал (вопрос после перевода): объяснение — системный алерт,
      // а лист под ним поднять нельзя, поэтому разговор на этом кончается.
      explain(target, mode);
      finish();
      return;
    }
    void confirmAction(text.title, {
      message: text.message,
      confirmLabel: text.confirm,
      destructive: decision.kind !== "transfer",
    }).then((ok) => {
      if (!mounted.current) return;
      const step = stepAfterAnswer(decision, ok);
      if (step === "return") {
        returnSheet();
      } else if (step === "trash") {
        void trashAcc.mutateAsync(target.id).then(() => {
          toast(`Счёт «${target.name}» удалён`, "success", {
            label: "Отменить",
            onPress: () =>
              restoreAcc.mutate(target.id, {
                onError: (e) => toast(`Не удалось вернуть счёт: ${e.message}`, "error"),
              }),
          });
          finish();
        }, fail("Не удалось удалить счёт"));
      } else if (decision.kind === "close") {
        void closeAcc
          .mutateAsync({ id: target.id })
          .then(() => {
            toast(`Счёт «${target.name}» скрыт`);
            finish();
          }, fail("Не удалось скрыть счёт"));
      } else if (decision.kind === "transfer") {
        // Минус лечится переводом В счёт, плюс — переводом ИЗ него: один лист,
        // разное направление.
        const incoming = decision.direction === "in";
        closingFrom.current = { account: target, mode };
        setPreset({
          fromId: incoming ? null : target.id,
          toId: incoming ? target.id : null,
          amount: decision.amount,
        });
        later(AFTER_SHEET_MS, () => setTransferOpen(true));
      }
    });
  };

  /** Тап по «Скрыть счёт» / «Удалить счёт» в открытом листе. */
  const start = (
    account: AccountWithBalance,
    accounts: readonly AccountWithBalance[],
    mode: Mode,
  ) => {
    knownAccounts.current = accounts;
    const active = accounts.filter((other) => other.is_active);
    const decision: Decision =
      mode === "trash" ? trashDecision(account, active) : hideDecision(account, active);
    if (!questionText(account, decision, mode, accounts)) {
      // Объяснение без вопроса: системный алерт встаёт поверх листа, и лист
      // уезжать не должен.
      explain(account, mode);
      return;
    }
    afterExit.current = () => ask(account, decision, mode);
    setParked(true);
  };

  /**
   * «ПЕРЕВЕСТИ» ИЗ ЛИСТА СЧЁТА (владелец 2026-09-23, идея из отчёта по
   * счетам: «сдать наличные на карту» — самое частое действие со счётом, а
   * дверь к нему была только на «Финансах»). Лист уезжает с дороги (два листа
   * в одном кадре iOS не покажет), открывается тот же лист перевода, что в
   * футере «Финансов», с этим счётом источником и всем его остатком; по
   * закрытии лист счёта возвращается — вопроса о скрытии здесь нет.
   */
  const startTransfer = (account: AccountWithBalance) => {
    closingFrom.current = null;
    // С деньгами счёт — источник; пустой или в минусе — получатель: с него
    // переводить нечего, а пополнить его — ровно то, что с ним делают.
    const outgoing = moneySign(account.balance) > 0;
    setPreset({
      fromId: outgoing ? account.id : null,
      toId: outgoing ? null : account.id,
      amount: null,
    });
    afterExit.current = () => setTransferOpen(true);
    setParked(true);
  };

  const onSheetExited = () => {
    const run = afterExit.current;
    afterExit.current = null;
    run?.();
  };

  const onTransferClose = () => {
    setTransferOpen(false);
    const before = closingFrom.current;
    closingFrom.current = null;
    if (!before) {
      returnSheet();
      return;
    }
    const { account: from, mode } = before;
    void Promise.all([
      Promise.race([
        freshAccounts(qc, tenantId),
        delay(FRESH_TIMEOUT_MS, undefined),
      ]),
      delay(AFTER_SHEET_MS, null),
    ]).then(([fresh]) => {
      if (!mounted.current) return;
      // Вопрос после перевода — по свежему остатку и ради того же, ради
      // чего переводили: скрыть или удалить.
      const next =
        mode === "trash"
          ? trashDecisionAfterTransfer(from, fresh)
          : hideDecisionAfterTransfer(from, fresh);
      if (!next) setParked(false);
      else ask(next.account, next.decision, mode);
    });
  };

  return {
    /** Лист уехал на время разговора: `visible && !parked`. */
    parked,
    start,
    startTransfer,
    onSheetExited,
    transfer: {
      visible: transferOpen,
      fromId: preset?.fromId ?? null,
      toId: preset?.toId ?? null,
      amount: preset?.amount ?? null,
      onClose: onTransferClose,
    },
  };
}
