import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isOnline } from "@babun/shared/sync";
import { SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { useToast } from "@/components/ui/Toast";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import { useTenantId } from "@/lib/tenant";
import type { Team } from "@/features/reference/queries";
import {
  useRestoreAccount,
  useSetAccountHidden,
  useTrashAccount,
  type AccountWithBalance,
} from "../accounts";
import {
  OFFLINE_ACCOUNT_EDIT,
  accountNotEmptyAlert,
  trashAccountAlert,
} from "../account-alerts";
import { sortAccountRows } from "../accounts-sections";
import { TransferSheet } from "../TransferSheet";
import { freshAccounts } from "./fresh-accounts";
import { isLastOpenOfTeam } from "../close-decision";
import {
  trashDecision,
  trashDecisionAfterTransfer,
  type TrashDecision,
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

// ЖЕСТЫ СТРОКИ НА СТРАНИЦЕ «СЧЕТА».
//
// «СКРЫТЬ» — СЧЁТ ДЛЯ СЕБЯ (владелец 03.10: «скрыть — чтоб он скрылся со
// всего, но им можно было пользоваться; нигде не показывался, только в
// счетах; для всех невидимый»). Скрытый счёт работает — на него переводят, —
// но виден только здесь и только владельцу; деньги записи он не принимает.
// Вопроса нет: действие обратимо тем же жестом («Показать»), а тост держит
// «Отменить» — счёт возвращается каким был, с прежним «В оплате записи».
//
// «УДАЛИТЬ» (владелец 03.10: «свайпом удалять, они попадают в папку
// „Удалённые счета" на 30 дней, как клиенты»): удалить можно только пустой
// счёт, поэтому деньги сначала уводятся переводом, ноль — вопрос «Удалить
// счёт?», и счёт уходит в «Удалённые счета». Тост держит «Отменить».
export function useHideAccount({
  accounts,
  teamById,
}: {
  /** Все счета тенанта с остатками (со скрытыми); закрытые отсеиваются здесь. */
  accounts: readonly AccountWithBalance[];
  teamById: Map<string, Team>;
}): {
  hide: (account: AccountWithBalance) => void;
  remove: (account: AccountWithBalance) => void;
  sheet: ReactNode;
} {
  const qc = useQueryClient();
  const tenantId = useTenantId();
  const toast = useToast();
  const setHidden = useSetAccountHidden();
  const trashAcc = useTrashAccount();
  const restoreAcc = useRestoreAccount();

  const [transferOpen, setTransferOpen] = useState(false);
  const [preset, setPreset] = useState<TransferPreset>({
    fromId: null,
    toId: null,
    amount: null,
  });
  /** Счёт в момент вопроса: перевод затеян ради удаления. */
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

  // В порядке строк: так их видит человек и в листе перевода.
  const active = useMemo(
    () => sortAccountRows(accounts.filter((account) => account.is_active)),
    [accounts],
  );

  const failed = (verb: string) => (e: unknown) =>
    toast(isOnline() ? `Не удалось ${verb} счёт: ${reason(e)}` : OFFLINE_ACCOUNT_EDIT, "error");

  /** «Скрыть» ⇄ «Показать» — сразу, с «Отменить» в тосте. */
  const toggleHidden = (target: AccountWithBalance) => {
    if (target.is_hidden) {
      setHidden.mutateAsync({ id: target.id, hidden: false }).then(
        () => toast(`Счёт «${target.name}» снова виден`),
        failed("показать"),
      );
      return;
    }
    const wasInPayments = target.show_in_payments;
    setHidden.mutateAsync({ id: target.id, hidden: true }).then(
      () =>
        toast(`Счёт «${target.name}» скрыт`, "success", {
          label: "Отменить",
          onPress: () =>
            setHidden.mutate(
              { id: target.id, hidden: false, showInPayments: wasInPayments },
              { onError: (e) => toast(`Не удалось показать счёт: ${e.message}`, "error") },
            ),
        }),
      failed("скрыть"),
    );
  };

  const trash = (target: AccountWithBalance) =>
    trashAcc.mutateAsync(target.id).then(
      () =>
        toast(`Счёт «${target.name}» удалён`, "success", {
          label: "Отменить",
          onPress: () =>
            restoreAcc.mutate(target.id, {
              onError: (e) => toast(`Не удалось вернуть счёт: ${e.message}`, "error"),
            }),
        }),
      failed("удалить"),
    );

  const ask = (target: AccountWithBalance, decision: TrashDecision) => {
    if (decision.kind === "trash") {
      const text = trashAccountAlert(
        target.name,
        target.is_active && isLastOpenOfTeam(target, accounts),
      );
      confirmThen(
        text.title,
        { message: text.message, confirmLabel: text.confirm, destructive: true },
        () => void trash(target),
      );
      return;
    }
    const text = accountNotEmptyAlert(
      target.name,
      target.balance,
      decision.kind === "transfer",
      "Удалить",
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
        // лист не появлялся вовсе (ревью 2026-09-15).
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
        const from = closingFrom.current;
        closingFrom.current = null;
        if (!from) return;
        void Promise.all([
          Promise.race([
            freshAccounts(qc, tenantId),
            delay(FRESH_TIMEOUT_MS, undefined),
          ]),
          delay(AFTER_SHEET_MS, null),
        ]).then(([fresh]) => {
          if (!mounted.current) return;
          const next = trashDecisionAfterTransfer(from, fresh);
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

  return {
    hide: toggleHidden,
    remove: (account) => ask(account, trashDecision(account, active)),
    sheet,
  };
}
