import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isOnline } from "@babun/shared/sync";
import { SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { useToast } from "@/components/ui/Toast";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import { useTenantId } from "@/lib/tenant";
import type { Team } from "@/features/reference/queries";
import { useSoftCloseAccount, type AccountWithBalance } from "../accounts";
import {
  OFFLINE_ACCOUNT_EDIT,
  accountNotEmptyAlert,
  hideAccountAlert,
} from "../account-alerts";
import { sortAccountRows } from "../accounts-sections";
import { TransferSheet } from "../TransferSheet";
import { freshAccounts } from "./fresh-accounts";
import {
  hideDecision,
  hideDecisionAfterTransfer,
  type HideDecision,
} from "./page-rules";

/** Вопрос поверх уезжающего листа iOS не покажет («already presenting»). */
const AFTER_SHEET_MS = SHEET_EXIT_MS + 350;
/** Дольше свежих остатков не ждём: без ответа вопрос не задаётся вовсе, а не
 *  всплывает через минуту поверх другого экрана. */
const FRESH_TIMEOUT_MS = 6000;

const delay = <T,>(ms: number, value: T) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface TransferPreset {
  /** Плюсовой счёт уходит источником. */
  fromId: string | null;
  /** Минусовой счёт пополняют — он получатель. */
  toId: string | null;
  amount: number | null;
}

// «СКРЫТЬ» НА СТРАНИЦЕ «СЧЕТА» — ЗАКРЫТИЕ ОДНИМ ЗАХОДОМ (владелец 2026-09-15:
// «влево свайп — скрыть»).
//
// Скрыть счёт — значит закрыть его: он уходит из форм оплаты и падает в
// «Закрытые счета», откуда его открывают тем же жестом. Удаления за этим
// словом нет (`hideDecision`). Порядок тот же, что у закрытия из правки
// счёта, и тексты оттуда же (`account-alerts`):
//   • остаток ноль — «Закрыть счёт?», затем тост;
//   • остаток есть и его есть куда увести — лист перевода с готовой суммой, а
//     по его закрытии тот же вопрос заново, уже по свежему остатку;
//   • увести некуда — объяснение, а не вопрос.
// Закрытие обратимо, но вопрос перед ним остаётся: так скрывают услугу, и за
// основным счётом команды текст называет, кому перейдёт «основной».
export function useHideAccount({
  accounts,
  teamById,
}: {
  /** Все счета тенанта с остатками; закрытые отсеиваются здесь. */
  accounts: readonly AccountWithBalance[];
  teamById: Map<string, Team>;
}): { hide: (account: AccountWithBalance) => void; sheet: ReactNode } {
  const qc = useQueryClient();
  const tenantId = useTenantId();
  const toast = useToast();
  const closeAcc = useSoftCloseAccount();

  const [transferOpen, setTransferOpen] = useState(false);
  const [preset, setPreset] = useState<TransferPreset>({
    fromId: null,
    toId: null,
    amount: null,
  });
  /** Счёт в момент вопроса: перевод затеян ради скрытия. */
  const closingFrom = useRef<AccountWithBalance | null>(null);
  // СТРАНИЦУ МОГЛИ ПОКИНУТЬ, ПОКА ЖДАЛИ ОСТАТКИ: вопрос всплыл бы над чужим
  // экраном.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // В порядке строк: преемник «основного» — следующий счёт своей команды.
  const active = useMemo(
    () => sortAccountRows(accounts.filter((account) => account.is_active)),
    [accounts],
  );

  const ask = (
    target: AccountWithBalance,
    decision: HideDecision<AccountWithBalance>,
  ) => {
    if (decision.kind === "close") {
      const text = hideAccountAlert(
        target.name,
        decision.successor?.name ?? null,
      );
      confirmThen(
        text.title,
        { message: text.message, confirmLabel: text.confirm, destructive: true },
        () =>
          closeAcc
            .mutateAsync({ id: target.id, successor: decision.successor })
            .then(
              () => toast(`Счёт «${target.name}» скрыт`),
              (e: unknown) =>
                toast(
                  isOnline()
                    ? `Не удалось закрыть счёт: ${reason(e)}`
                    : OFFLINE_ACCOUNT_EDIT,
                  "error",
                ),
            ),
      );
      return;
    }
    const text = accountNotEmptyAlert(
      target.name,
      target.balance,
      decision.kind === "transfer",
    );
    if (decision.kind === "explain" || !text.confirm) {
      notify(text.title, text.message);
      return;
    }
    const { direction, amount } = decision;
    confirmThen(
      text.title,
      { message: text.message, confirmLabel: text.confirm },
      () => {
        setPreset({
          fromId: direction === "out" ? target.id : null,
          toId: direction === "in" ? target.id : null,
          amount,
        });
        closingFrom.current = target;
        // ЛИСТ ПЕРЕВОДА — ПОСЛЕ ТОГО, КАК УЕХАЛ ВОПРОС. `confirmThen` отвечает
        // в миг тапа, пока шторка вопроса ещё уезжает, и открытый в этот кадр
        // лист не появлялся вовсе, а флаг «открыт» оставался — следующее
        // «Скрыть» на счёте с деньгами молчало до выхода со страницы (ревью
        // 2026-09-15).
        setTimeout(() => {
          if (mounted.current) setTransferOpen(true);
        }, AFTER_SHEET_MS);
      },
    );
  };

  const sheet = (
    <TransferSheet
      visible={transferOpen}
      onClose={() => {
        setTransferOpen(false);
        const before = closingFrom.current;
        closingFrom.current = null;
        if (!before) return;
        void Promise.all([
          Promise.race([
            freshAccounts(qc, tenantId),
            delay(FRESH_TIMEOUT_MS, undefined),
          ]),
          delay(AFTER_SHEET_MS, null),
        ]).then(([fresh]) => {
          if (!mounted.current) return;
          const next = hideDecisionAfterTransfer(before, fresh);
          if (next) ask(next.account, next.decision);
        });
      }}
      accounts={active}
      teamById={teamById}
      presetFromId={preset.fromId}
      presetToId={preset.toId}
      presetAmount={preset.amount}
    />
  );

  return { hide: (account) => ask(account, hideDecision(account, active)), sheet };
}
