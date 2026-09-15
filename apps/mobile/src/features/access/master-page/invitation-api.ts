import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Database } from "@babun/shared/db/database.types";

import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

import {
  createInvitationArgs,
  invitationRowPatch,
  MasterInvitationError,
  parseSavedInvitation,
  updateInvitationArgs,
  type CreateInvitationArgs,
  type SavedMasterInvitation,
  type UpdateInvitationArgs,
} from "./invitation-contract";
import type { MasterInvitationRequest } from "./master-draft";

// ПРИГЛАШЕНИЕ С КАРТОЧКОЙ — ЕДИНСТВЕННАЯ ДОРОГА К СЕРВЕРУ (владелец 15.09:
// «„Добавить мастера" — сразу полная карточка»). Календари, должность, цвет и
// права уходят вместе с приглашением и правятся, пока человек не ответил.
// Прежняя шторка (`team-access.ts` → `useCreateInvitation`) остаётся для
// своих вызовов; карточка мастера ходит только сюда — второй дороги к тем же
// функциям базы из карточки нет.

type InvitationRow = Database["public"]["Tables"]["invitations"]["Row"];

type InvitationFn = "create_invitation" | "update_invitation";
type ServerArgs<F extends InvitationFn> = Database["public"]["Functions"][F]["Args"];

/** Ключ, которого у функции базы нет, становится `never`: опечатка в имени
 *  аргумента не соберётся. */
type KnownArgs<A, F extends InvitationFn> = A & Record<Exclude<keyof A, keyof ServerArgs<F>>, never>;

type RpcReply = PromiseLike<{
  data: unknown;
  error: { message: string; hint?: string | null; code?: string | null } | null;
}>;

/** УЗКАЯ ПОДПИСЬ ВЫЗОВА. Миграция 20260915110000 применена, и типы базы знают
 *  оба вызова, но генератор пишет текстовые аргументы как `string`, а сервер
 *  принимает `null` («поля нет», «стереть должность»). Поэтому значения
 *  описывает `invitation-contract.ts`, а имена сверяются с типами базы здесь,
 *  компилятором, и с самой миграцией — `invitation-contract.test.ts`. */
type InvitationRpc = {
  (fn: "create_invitation", args: KnownArgs<CreateInvitationArgs, "create_invitation">): RpcReply;
  (fn: "update_invitation", args: KnownArgs<UpdateInvitationArgs, "update_invitation">): RpcReply;
};

const invitationRpc = supabase.rpc.bind(supabase) as unknown as InvitationRpc;

/** Та же проверка, что у прежних приглашений (`team-access.ts`): сервер и сам
 *  откажет не владельцу, но так отказ приходит словами, а не строкой базы. */
async function requireOwner(): Promise<void> {
  const { data, error } = await supabase.rpc("current_user_role");
  if (error) throw new Error(error.message);
  if (data !== "owner") {
    throw new Error("Управлять доступом может только владелец.");
  }
}

/** «Пригласить» на карточке нового мастера. */
export function useCreateMasterInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (request: MasterInvitationRequest): Promise<SavedMasterInvitation> => {
      await requireOwner();
      // Кнопку и так держит `inviteBlockers`; строка сервера — чтобы отказ
      // назвал `invitationErrorMessage`, если сюда всё же дошли без календаря.
      if (request.teamIds.length === 0) {
        throw new MasterInvitationError({
          message: "master invitation requires a calendar or an employee card",
        });
      }
      const { data, error } = await invitationRpc(
        "create_invitation",
        createInvitationArgs(request),
      );
      if (error) throw new MasterInvitationError(error);
      return parseSavedInvitation(data);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tenant-invitations"] }),
    meta: { errorHandled: true },
  });
}

/** Правка ждущего приглашения — с карточки и со страницы прав. Приглашение
 *  уходит целиком (сервер заменяет календари, должность, цвет и права одним
 *  набором), а в кэш «Ждут ответа» правка ложится сразу: карточка и страница
 *  прав — два экрана стека, и оба читают эту строку. Отказ возвращает кэш
 *  как был. */
export function useUpdateMasterInvitation() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const key = ["tenant-invitations", tenantId] as const;
  return useMutation({
    mutationFn: async ({
      invitationId,
      request,
    }: {
      invitationId: string;
      request: MasterInvitationRequest;
    }): Promise<SavedMasterInvitation> => {
      await requireOwner();
      const { data, error } = await invitationRpc(
        "update_invitation",
        updateInvitationArgs(invitationId, request),
      );
      if (error) throw new MasterInvitationError(error);
      return parseSavedInvitation(data);
    },
    onMutate: async ({ invitationId, request }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<InvitationRow[]>(key);
      if (previous) {
        const patch = invitationRowPatch(request);
        qc.setQueryData<InvitationRow[]>(
          key,
          previous.map((row) =>
            row.id === invitationId ? Object.assign({}, row, patch) : row,
          ),
        );
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) qc.setQueryData(key, context.previous);
      void qc.invalidateQueries({ queryKey: ["tenant-invitations"] });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tenant-invitations"] }),
    meta: { errorHandled: true },
  });
}
