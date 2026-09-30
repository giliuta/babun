import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { useSession } from "@/providers/SessionProvider";
import { invitationErrorMessage } from "@/features/settings/invitation-flow";
import { activateAcceptedInvitation } from "@/features/settings/invitations";

import { isInvitationGone, parseMyInvitations, type IncomingInvitation } from "./invitation-inbox";
import { AccessRequestError } from "./queries";

// ВХОДЯЩИЕ ПРИГЛАШЕНИЯ — ДОРОГА К СЕРВЕРУ (STORY-081, контракт 006). Список
// принадлежит ЧЕЛОВЕКУ, а не компании: приглашения приходят из чужих компаний,
// поэтому ключ по пользователю и без заголовка компании.

export const myInvitationsKeyRoot = ["my-invitations"] as const;

export function useMyInvitations() {
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  return useQuery({
    queryKey: [...myInvitationsKeyRoot, userId],
    enabled: !!userId,
    // Функции ещё может не быть на сервере — тогда карточки просто нет, без
    // трёх повторов в сеть на каждом открытии главного экрана.
    retry: false,
    queryFn: async (): Promise<IncomingInvitation[]> => {
      const { data, error } = await supabase.rpc("my_invitations");
      if (error) throw new AccessRequestError(error);
      return parseMyInvitations(data);
    },
  });
}

/** Принять: членство и права — на сервере, переход в компанию — тем же шагом,
 *  что у приёма по ссылке (`activateAcceptedInvitation`). */
export function useAcceptInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (invitation: IncomingInvitation): Promise<string> => {
      const { data: tenantId, error } = await supabase.rpc("accept_invitation_by_id", {
        p_invitation_id: invitation.id,
      });
      if (error || !tenantId) {
        throw new Error(invitationErrorMessage(error?.message ?? "invitation not found"));
      }
      await activateAcceptedInvitation(tenantId, invitation.role);
      return tenantId;
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: myInvitationsKeyRoot }),
    meta: { errorHandled: true },
  });
}

/** Отклонить. «Приглашения уже нет» — готовый результат, а не ошибка. */
export function useDeclineInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (invitationId: string): Promise<void> => {
      const { error } = await supabase.rpc("decline_invitation", {
        p_invitation_id: invitationId,
      });
      if (error && !isInvitationGone(error)) {
        throw new Error(invitationErrorMessage(error.message));
      }
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: myInvitationsKeyRoot }),
    meta: { errorHandled: true },
  });
}
