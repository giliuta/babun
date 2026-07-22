import { LargeSecureStore } from "@/lib/secure-store";
import { queryClient } from "@/lib/query-client";
import { isInvitationToken } from "./invitation-flow";

const PENDING_INVITATION_KEY = "babun.pending-invitation.v1";
export const pendingInvitationQueryKey = ["pending-invitation"] as const;

export async function getPendingInvitationToken(): Promise<string | null> {
  const value = await LargeSecureStore.getItem(PENDING_INVITATION_KEY);
  if (value == null) return null;
  if (isInvitationToken(value)) return value;
  await LargeSecureStore.removeItem(PENDING_INVITATION_KEY);
  return null;
}

export async function rememberPendingInvitationToken(
  token: string,
): Promise<void> {
  if (!isInvitationToken(token)) throw new Error("Некорректная ссылка");
  await LargeSecureStore.setItem(PENDING_INVITATION_KEY, token);
  queryClient.setQueryData(pendingInvitationQueryKey, token);
}

/** Clear only the token this flow consumed; a newer deep link that arrived
 * while a previous acceptance was finishing must survive. */
export async function clearPendingInvitationToken(
  expectedToken?: string,
): Promise<void> {
  if (expectedToken) {
    const current = await getPendingInvitationToken();
    if (current !== expectedToken) return;
  }
  await LargeSecureStore.removeItem(PENDING_INVITATION_KEY);
  queryClient.setQueryData(pendingInvitationQueryKey, null);
}
