// Account and transfer writes.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  deleteAccount,
  insertAccount,
  listAccounts,
  reopenAccount,
  restoreAccount,
  softCloseAccount,
  trashAccount,
  updateAccount,
  type AccountDraft,
} from "@babun/shared/db/repositories/accounts";
import {
  createTransfer,
  deleteTransfer,
  type TransferDraft,
} from "@babun/shared/db/repositories/finance-transactions";
import type { Account } from "@babun/shared/local/finance/account";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import {
  TEAM_ACCOUNT_SEEDS,
  planAccountSeeds,
  type AccountSeed,
} from "../account-seeds";
import { NEVER_PAUSE, invalidateAccounts } from "./shared";

export function useReopenAccount() {
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: (id: string) => reopenAccount(supabase, id),
    onSuccess: () => invalidateAccounts(qc),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

/** «Удалить» — счёт уходит в «Удалённые счета»; правила держит сервер. */
export function useTrashAccount() {
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: (id: string) => trashAccount(supabase, id),
    onSuccess: () => invalidateAccounts(qc),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

/** «Скрыть» / «Показать». Прячет счёт вместе с «В оплате
 *  записи»: скрытый счёт деньги записи не принимает (база держит это
 *  ограничением). Вернуть «В оплате» можно передать в `showInPayments` —
 *  так «Отменить» возвращает счёт ровно каким он был. */
export function useSetAccountHidden() {
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: (input: { id: string; hidden: boolean; showInPayments?: boolean }) =>
      updateAccount(
        supabase,
        input.id,
        input.hidden
          ? { is_hidden: true, show_in_payments: false }
          : {
              is_hidden: false,
              ...(input.showInPayments !== undefined ? { show_in_payments: input.showInPayments } : {}),
            },
      ),
    onSuccess: () => invalidateAccounts(qc),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

/** «Вернуть» из «Удалённых счетов» — обычный открытый счёт. */
export function useRestoreAccount() {
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: (id: string) => restoreAccount(supabase, id),
    onSuccess: () => invalidateAccounts(qc),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

// Жёсткое удаление счёта без единой операции (опечатка сразу после
// создания); сервер отклонит счёт с историей.
export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: (id: string) => deleteAccount(supabase, id),
    onSuccess: () => invalidateAccounts(qc),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

export function useInsertAccount() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: (draft: AccountDraft) =>
      insertAccount(supabase, tenantId as string, draft),
    onSuccess: () => invalidateAccounts(qc),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: ({ id, patch }: { id: string; patch: Partial<AccountDraft> }) =>
      updateAccount(supabase, id, patch),
    onSuccess: () => invalidateAccounts(qc),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

/**
 * Новый порядок строк группы (одна команда либо счета компании): пишем
 * позиции 0, 1, 2… по списку id.
 *
 * Параллельно, а не по очереди: уникального индекса на (tenant_id,
 * brigade_id, position) в базе НЕТ и заведён он не будет — миграция
 * 20260810170200 объясняет, почему (перестановка двух строк неизбежно
 * проходит через промежуточный дубль позиции). Значит, гонки за одно
 * значение здесь не существует, и семь строк не должны ехать семью
 * последовательными запросами.
 *
 * Порядок — это и ОПЛАТА: выше в списке — первым среди
 * плиток оплаты и первым среди счетов своего вида, когда оплату записали
 * способом без выбора счёта.
 */
export function useReorderAccounts() {
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    // ДО КОНЦА ВСЕХ, а не до первого отказа: `Promise.all` отпускал мутацию на
    // первой ошибке, пока остальные записи ещё шли, — перечитывание успевало
    // раньше них и показывало смесь старых и новых позиций.
    mutationFn: async (ids: readonly string[]) => {
      const results = await Promise.allSettled(
        ids.map((id, index) => updateAccount(supabase, id, { position: index })),
      );
      const failed = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (failed) throw failed.reason;
    },
    // Перечитываем при ЛЮБОМ исходе: частичный отказ оставляет часть позиций
    // записанной, и экран обязан показать то, что есть в базе.
    onSettled: () => invalidateAccounts(qc),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

/**
 * Автосоздание счетов (ТЗ §5.1). Тумблера нет: команда без счёта не может
 * принять деньги вообще. Единственный живой вызов — `useCreateTeamAccounts`
 * с `TEAM_ACCOUNT_SEEDS` («Наличные» и «Карта» новой команде); сида «счетов
 * компании» нет — счёт принадлежит ровно одной команде,
 * и заводить общий счёт некому.
 *
 * Каждый счёт — один `insertAccount`, никаких привязок вторым запросом.
 * Обрыв (потеря сети между вставками, убитое приложение) оставляет часть
 * счетов незаведённой — и лечится повтором: план считает `planAccountSeeds`,
 * который пропускает уже существующие имена, включая закрытые.
 */
function useSeedAccounts(seeds: readonly AccountSeed[]) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: async (brigadeId: string): Promise<Account[]> => {
      const tenant = tenantId as string;
      // Полный список, включая закрытые: имя занято и закрытым счётом.
      const existing = await listAccounts(supabase, tenant, {
        includeInactive: true,
      });
      const plan = planAccountSeeds({ seeds, existing, brigadeId });
      const created: Account[] = [];
      // Последовательно: у второй вставки нет причины гоняться с первой, а
      // при отказе понятно, что успело завестись.
      for (const item of plan) {
        created.push(
          await insertAccount(supabase, tenant, {
            scope: "team",
            brigade_id: brigadeId,
            name: item.name,
            kind: item.kind,
            position: item.position,
          }),
        );
      }
      return created;
    },
    onSuccess: () => invalidateAccounts(qc),
    meta: { errorHandled: true }, // call sites toast themselves
  });
}

/** «Наличные» и «Карта» новой команде. Аргумент мутации — id команды. */
export function useCreateTeamAccounts() {
  return useSeedAccounts(TEAM_ACCOUNT_SEEDS);
}

/** Закрытие счёта. «Основного» нет, и
 *  передавать при закрытии нечего. */
export function useSoftCloseAccount() {
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: async ({ id }: { id: string }) => {
      await softCloseAccount(supabase, id);
    },
    onSuccess: () => invalidateAccounts(qc),
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

export function useCreateTransfer() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: (draft: TransferDraft) =>
      createTransfer(supabase, tenantId as string, draft),
    // И после отказа: оборванный ответ мог уже провести перевод.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

// Removes BOTH legs of a transfer pair by transfer_group_id (web parity:
// the ledger must never carry a half-transfer — see createTransfer's
// invariant in the shared repository).
export function useDeleteTransfer() {
  const qc = useQueryClient();
  return useMutation({
    // «Отменить» в тосте — тоже запись: без сети она обязана сказать «не
    // получилось», а не тихо ждать связи, пока тост уже уехал.
    ...NEVER_PAUSE,
    mutationFn: (groupId: string) => deleteTransfer(supabase, groupId),
    // И после отказа: оборванный ответ мог уже провести перевод.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
    meta: { errorHandled: true }, // call sites alert themselves
  });
}
