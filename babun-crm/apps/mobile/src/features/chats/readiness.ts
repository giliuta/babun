/**
 * Unified inbox readiness is intentionally explicit and fail-closed.
 *
 * The existing chat UI models external WhatsApp / Instagram / Telegram / SMS
 * conversations. A device-local echo is not a delivery mechanism: showing an
 * outgoing bubble as `sent` without a provider acknowledgement would lose
 * customer messages and mislead the dispatcher.
 *
 * Keep every prerequisite false until the corresponding server contract is
 * implemented and verified. The local prototype store is separately blocked
 * in store.ts, so changing this matrix alone cannot expose fake delivery.
 */
export const MESSAGING_READINESS = Object.freeze({
  conversationSchema: false,
  tenantRls: false,
  realtimeSync: false,
  outboundProviderDelivery: false,
  inboundSignedWebhooks: false,
  providerIdentityMapping: false,
  mediaStorage: false,
} satisfies Record<string, boolean>);

export type MessagingReadiness = typeof MESSAGING_READINESS;

export const MESSAGING_BLOCKERS = Object.freeze([
  "server-conversation-schema",
  "tenant-role-rls",
  "realtime-read-state",
  "outbound-provider-adapters",
  "signed-inbound-webhooks",
  "provider-account-identities",
  "private-message-media-storage",
] as const);

export const MESSAGING_UNAVAILABLE_MESSAGE =
  "Каналы сообщений ещё не подключены. Приложение не будет показывать локальные ответы как отправленные.";

export class MessagingUnavailableError extends Error {
  readonly code = "messaging_not_ready";

  constructor() {
    super(MESSAGING_UNAVAILABLE_MESSAGE);
    this.name = "MessagingUnavailableError";
  }
}

export function isMessagingReady(
  readiness: Record<keyof MessagingReadiness, boolean> = MESSAGING_READINESS,
): boolean {
  return Object.values(readiness).every(Boolean);
}

export function requireMessagingReady(): void {
  if (!isMessagingReady()) throw new MessagingUnavailableError();
}
