import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  loadChats,
  saveChats,
  seedDemoChats,
  type Chat,
  type ChatMessage,
  type ConversationStatus,
} from "@babun/shared/local/chats";
import { getStorage } from "@babun/shared/storage/provider";

// STORY-053a — the demo seed MUST NOT auto-fire on empty load: new tenants
// get an empty inbox (see the contract note in shared/local/chats.ts).
// Older mobile builds DID auto-seed on first open, so purge those demo
// dialogs once. Signature = the fixed seed ids from seedDemoChats();
// real chats get generateId() ids ("chat-<ts36>-<rand>"), so a plain
// "chat-N" id can only come from the seed.
const DEMO_SEED_IDS = new Set(["chat-1", "chat-2", "chat-3", "chat-4"]);
const DEMO_PURGE_KEY = "babun-chats-demo-purged";

// A seed dialog the user of an old build «оживил» is user data now — the
// purge must spare it. Signs of life: a linked real client, an unsent
// draft, or an outgoing message the USER sent. The seeds themselves ship
// canned "out" messages with fixed short ids ("m2", "m5", "m8"…), while
// user-sent ones come from msgId() → "m_<ts>_<rand>", so the generated
// prefix cleanly separates the two.
function isUntouchedDemoSeed(c: Chat): boolean {
  if (!DEMO_SEED_IDS.has(c.id)) return false;
  if (c.client_id != null) return false;
  if ((c.draft ?? "").trim().length > 0) return false;
  if (c.messages.some((m) => m.direction === "out" && m.id.startsWith("m_")))
    return false;
  return true;
}

function loadPurged(): Chat[] {
  const chats = loadChats();
  if (getStorage().get<boolean>(DEMO_PURGE_KEY)) return chats;
  const cleaned = chats.filter((c) => !isUntouchedDemoSeed(c));
  if (cleaned.length !== chats.length) saveChats(cleaned);
  getStorage().set(DEMO_PURGE_KEY, true);
  return cleaned;
}

const msgId = () =>
  `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export function useChats() {
  return useQuery({
    queryKey: ["chats"],
    queryFn: () => loadPurged(),
    staleTime: Infinity,
  });
}

export function useChat(id: string): Chat | null {
  const { data } = useChats();
  return data?.find((c) => c.id === id) ?? null;
}

// Apply a transform to one chat, persist, and update the cache.
function useChatMutation<V>(fn: (chats: Chat[], v: V) => Chat[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: V) => {
      const next = fn(loadChats(), v);
      saveChats(next);
      return next;
    },
    onSuccess: (next) => qc.setQueryData(["chats"], next),
  });
}

export function useSendMessage() {
  return useChatMutation<{ chatId: string; text: string; replyToId?: string | null }>(
    (chats, { chatId, text, replyToId }) => {
      const now = new Date().toISOString();
      const msg: ChatMessage = {
        id: msgId(),
        direction: "out",
        text,
        status: "sent",
        content_type: "text",
        timestamp: now,
        ...(replyToId ? { reply_to_id: replyToId } : {}),
      };
      return chats.map((c) =>
        c.id === chatId
          ? { ...c, messages: [...c.messages, msg], last_message_at: now, draft: "" }
          : c,
      );
    },
  );
}

export function useStarMessage() {
  return useChatMutation<{ chatId: string; messageId: string }>(
    (chats, { chatId, messageId }) =>
      chats.map((c) =>
        c.id === chatId
          ? {
              ...c,
              messages: c.messages.map((m) =>
                m.id === messageId ? { ...m, is_starred: !m.is_starred } : m,
              ),
            }
          : c,
      ),
  );
}

export function useDeleteMessage() {
  return useChatMutation<{ chatId: string; messageId: string }>(
    (chats, { chatId, messageId }) =>
      chats.map((c) =>
        c.id === chatId
          ? { ...c, messages: c.messages.filter((m) => m.id !== messageId) }
          : c,
      ),
  );
}

// Draft persistence — a direct write instead of useMutation so it can run
// from the thread screen's blur/unmount cleanup, where mutation observers
// are already torn down. Web parity: saveDraft() trims and saves when
// leaving a chat (web chats/page.tsx:123–129).
export function usePersistDraft() {
  const qc = useQueryClient();
  return useCallback(
    (chatId: string, draft: string) => {
      const trimmed = draft.trim();
      const chats = loadChats();
      const current = chats.find((c) => c.id === chatId);
      if (!current || (current.draft ?? "") === trimmed) return;
      const next = chats.map((c) =>
        c.id === chatId ? { ...c, draft: trimmed } : c,
      );
      saveChats(next);
      qc.setQueryData(["chats"], next);
    },
    [qc],
  );
}

export function useLinkClient() {
  return useChatMutation<{ chatId: string; clientId: string | null }>(
    (chats, { chatId, clientId }) =>
      chats.map((c) => (c.id === chatId ? { ...c, client_id: clientId } : c)),
  );
}

// Opening a conversation clears unread AND promotes new → active,
// matching the web openChat() semantics (web chats/page.tsx:135).
export function useMarkRead() {
  return useChatMutation<string>((chats, chatId) =>
    chats.map((c) =>
      c.id === chatId
        ? { ...c, unread_count: 0, status: c.status === "new" ? "active" : c.status }
        : c,
    ),
  );
}

// Web parity: togglePin (web chats/page.tsx:187–190).
export function useTogglePin() {
  return useChatMutation<string>((chats, chatId) =>
    chats.map((c) => (c.id === chatId ? { ...c, is_pinned: !c.is_pinned } : c)),
  );
}

// Web parity: closeChat / archiveChat (web chats/page.tsx:192–202).
// «Закрыть» keeps the dialog in the list (drops out of «Без ответа»);
// «В архив» hides it from the inbox entirely.
export function useSetChatStatus() {
  return useChatMutation<{ chatId: string; status: ConversationStatus }>(
    (chats, { chatId, status }) =>
      chats.map((c) => (c.id === chatId ? { ...c, status } : c)),
  );
}

// STORY-053a — demo data loads ONLY on explicit request from the empty
// inbox (auto-seed was removed in Wave 1 and must not come back). The
// shared seed OVERWRITES the stored list, so refuse to run when any real
// dialogs exist — the call site only shows the button on an empty inbox,
// this is the belt to that suspender.
export function useSeedDemoChats() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const existing = loadChats();
      if (existing.length > 0) return existing;
      const seeded = seedDemoChats();
      // Requested demos are user data — make sure the one-shot purge of
      // old auto-seeded builds never eats them on the next cold start.
      getStorage().set(DEMO_PURGE_KEY, true);
      return seeded;
    },
    onSuccess: (next) => qc.setQueryData(["chats"], next),
  });
}
