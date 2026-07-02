import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import {
  CornerUpLeft,
  Link2,
  Search,
  Send,
  Star,
  Trash2,
  X,
  Zap,
} from "lucide-react-native";
import { CHANNEL_LABELS, type ChatMessage } from "@babun/shared/local/chats";
import {
  detectLanguage,
  QUICK_REPLIES,
} from "@babun/shared/common/utils/quick-replies";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { useClients } from "@/features/clients/queries";
import {
  useChat,
  useDeleteMessage,
  useLinkClient,
  useMarkRead,
  usePersistDraft,
  useSendMessage,
  useStarMessage,
} from "@/features/chats/store";

function msgTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

function bodyOf(m: ChatMessage): string {
  if (m.content_type === "image") return "📷 Фото";
  if (m.content_type === "audio") return "🎤 Голосовое";
  if (m.content_type === "location") return "📍 Геолокация";
  return m.text;
}

// Memoized bubble — message objects are referentially stable across
// composer keystrokes, so typing doesn't re-render the visible thread.
const MessageRow = memo(function MessageRow({
  m,
  quoted,
  onLongPress,
}: {
  m: ChatMessage;
  quoted: ChatMessage | null;
  onLongPress: (m: ChatMessage) => void;
}) {
  const t = useThemeColors();
  const out = m.direction === "out";
  return (
    <Pressable
      onLongPress={() => onLongPress(m)}
      className={`my-0.5 max-w-[82%] ${out ? "self-end" : "self-start"}`}
    >
      <View
        className="rounded-2xl px-3.5 py-2"
        style={{
          backgroundColor: out
            ? t.accent
            : t.dark
              ? "rgba(255,255,255,0.07)"
              : "#eef1f5",
        }}
      >
        {quoted ? (
          <View
            className="mb-1 rounded-md border-l-2 px-2 py-1"
            style={{
              borderColor: out ? "rgba(255,255,255,0.6)" : t.accent,
              backgroundColor: out
                ? "rgba(255,255,255,0.15)"
                : t.dark
                  ? "rgba(255,255,255,0.06)"
                  : "rgba(11,18,32,0.05)",
            }}
          >
            <Text
              className="text-[11px]"
              style={{ color: out ? "rgba(255,255,255,0.8)" : t.sub }}
              numberOfLines={1}
            >
              {bodyOf(quoted)}
            </Text>
          </View>
        ) : null}
        <Text
          className="text-base"
          style={{ color: out ? "#fff" : t.ink }}
        >
          {bodyOf(m)}
        </Text>
      </View>
      <View className={`mt-0.5 flex-row items-center gap-1 px-1 ${out ? "justify-end" : ""}`}>
        {m.is_starred ? (
          <Star color={t.warning} size={11} fill={t.warning} />
        ) : null}
        <Text className="text-[10px]" style={{ color: t.faint }}>
          {msgTime(m.timestamp)}
        </Text>
      </View>
    </Pressable>
  );
});

export default function ChatThreadScreen() {
  const t = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const chat = useChat(id);
  const { data: clients = [] } = useClients();

  const send = useSendMessage();
  const star = useStarMessage();
  const del = useDeleteMessage();
  const persistDraft = usePersistDraft();
  const linkClient = useLinkClient();
  const markRead = useMarkRead();

  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [menuMsg, setMenuMsg] = useState<ChatMessage | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [clientQuery, setClientQuery] = useState("");

  // hydrate draft + mark read on open
  useEffect(() => {
    if (!chat) return;
    setDraft(chat.draft ?? "");
    if (chat.unread_count > 0) markRead.mutate(chat.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat?.id]);

  // Persist the draft whenever the screen loses focus (back nav, tab
  // switch, unmount) — not only on input blur; leaving with the keyboard
  // open used to drop the draft. Web parity: saveDraft() in openChat
  // (web chats/page.tsx:123–129). Refs keep the cleanup closure fresh.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const chatIdRef = useRef<string | null>(null);
  chatIdRef.current = chat?.id ?? null;
  useFocusEffect(
    useCallback(
      () => () => {
        if (chatIdRef.current) persistDraft(chatIdRef.current, draftRef.current);
      },
      [persistDraft],
    ),
  );

  const byId = useMemo(
    () => new Map((chat?.messages ?? []).map((m) => [m.id, m])),
    [chat?.messages],
  );
  // Inverted-list order: newest first (standard RN chat pattern — the
  // list stays pinned to the bottom without scrollToEnd forcing the
  // whole thread to render on open).
  const reversed = useMemo(
    () => [...(chat?.messages ?? [])].reverse(),
    [chat?.messages],
  );
  const lang = useMemo(
    () => detectLanguage((chat?.messages ?? []).map((m) => m.text)),
    [chat?.messages],
  );
  const linkedClient = chat?.client_id
    ? clients.find((c) => c.id === chat.client_id)
    : null;

  if (!chat) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Чат" />
        <EmptyState fill title="Диалог не найден" />
      </Screen>
    );
  }

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    send.mutate({ chatId: chat.id, text, replyToId: replyTo?.id ?? null });
    setReplyTo(null);
  };

  const filteredClients = useMemo(() => {
    const q = clientQuery.trim().toLowerCase();
    const base = q
      ? clients.filter(
          (c) =>
            c.full_name.toLowerCase().includes(q) ||
            (c.phone ?? "").includes(q),
        )
      : clients;
    return base.slice(0, 50);
  }, [clients, clientQuery]);

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        title={chat.contact_name || "Без имени"}
        subtitle={
          linkedClient
            ? `${CHANNEL_LABELS[chat.channel]} · ${linkedClient.full_name}`
            : CHANNEL_LABELS[chat.channel]
        }
        right={
          <Pressable
            onPress={() => setLinkOpen(true)}
            hitSlop={8}
            className="h-10 w-10 items-center justify-center rounded-full active:opacity-60"
          >
            <Link2 color={linkedClient ? t.accent : t.faint} size={ICON.sm} />
          </Pressable>
        }
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <FlatList
          style={{ flex: 1 }}
          data={reversed}
          // Only invert when there are messages — an inverted empty list
          // would render ListEmptyComponent upside down.
          inverted={reversed.length > 0}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 12, flexGrow: 1 }}
          renderItem={({ item }) => (
            <MessageRow
              m={item}
              quoted={item.reply_to_id ? (byId.get(item.reply_to_id) ?? null) : null}
              onLongPress={setMenuMsg}
            />
          )}
          ListEmptyComponent={
            <EmptyState title="Нет сообщений" subtitle="Напишите первым" />
          }
        />

        {/* reply quote bar */}
        {replyTo ? (
          <View
            className="flex-row items-center border-t px-3 py-2"
            style={{ borderColor: t.separator, backgroundColor: t.canvas }}
          >
            <View
              className="mr-2 h-8 w-1 rounded-full"
              style={{ backgroundColor: t.accent }}
            />
            <Text
              className="flex-1 text-sm"
              style={{ color: t.sub }}
              numberOfLines={1}
            >
              {bodyOf(replyTo)}
            </Text>
            <Pressable onPress={() => setReplyTo(null)} hitSlop={8}>
              <X color={t.sub} size={16} />
            </Pressable>
          </View>
        ) : null}

        {/* composer */}
        <View
          className="flex-row items-end gap-2 border-t px-3 py-2 pb-6"
          style={{ borderColor: t.separator, backgroundColor: t.surface }}
        >
          <Pressable
            onPress={() => setQrOpen(true)}
            className="h-10 w-10 items-center justify-center rounded-full active:opacity-60"
          >
            <Zap color={t.accent} size={ICON.sm} />
          </Pressable>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onBlur={() => persistDraft(chat.id, draft)}
            placeholder="Сообщение…"
            placeholderTextColor={t.placeholder}
            selectionColor={t.accent}
            keyboardAppearance={t.dark ? "dark" : "light"}
            multiline
            className="max-h-24 flex-1 rounded-2xl px-4 py-2.5 text-base"
            style={{
              backgroundColor: t.dark ? "rgba(255,255,255,0.07)" : "#eef1f5",
              color: t.ink,
            }}
          />
          <Pressable
            onPress={submit}
            disabled={!draft.trim()}
            className={`h-10 w-10 items-center justify-center rounded-full ${draft.trim() ? "active:opacity-80" : ""}`}
            style={{ backgroundColor: draft.trim() ? t.accent : t.disabledFill }}
          >
            <Send color="#fff" size={18} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {/* message context menu */}
      <Modal visible={!!menuMsg} transparent animationType="fade" onRequestClose={() => setMenuMsg(null)}>
        <Pressable
          className="flex-1 justify-end"
          style={{ backgroundColor: t.scrim }}
          onPress={() => setMenuMsg(null)}
        >
          <View
            className="m-3 overflow-hidden rounded-2xl"
            style={{ backgroundColor: t.surface }}
          >
            {[
              {
                label: "Ответить",
                icon: CornerUpLeft,
                onPress: () => {
                  setReplyTo(menuMsg);
                  setMenuMsg(null);
                },
              },
              {
                label: menuMsg?.is_starred ? "Убрать из избранного" : "В избранное",
                icon: Star,
                onPress: () => {
                  if (menuMsg) star.mutate({ chatId: chat.id, messageId: menuMsg.id });
                  setMenuMsg(null);
                },
              },
              {
                label: "Удалить",
                icon: Trash2,
                danger: true,
                onPress: () => {
                  if (menuMsg) del.mutate({ chatId: chat.id, messageId: menuMsg.id });
                  setMenuMsg(null);
                },
              },
            ].map((a, i) => (
              <Pressable
                key={a.label}
                onPress={a.onPress}
                className={`flex-row items-center gap-3 px-4 py-3.5 active:opacity-60 ${i > 0 ? "border-t" : ""}`}
                style={i > 0 ? { borderColor: t.separator } : undefined}
              >
                <a.icon color={a.danger ? t.danger : t.body} size={ICON.sm} />
                <Text
                  className="text-base"
                  style={{ color: a.danger ? t.danger : t.ink }}
                >
                  {a.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* quick replies */}
      <Modal visible={qrOpen} transparent animationType="slide" onRequestClose={() => setQrOpen(false)}>
        <Pressable
          className="flex-1"
          style={{ backgroundColor: t.scrim }}
          onPress={() => setQrOpen(false)}
        />
        <View
          className="absolute bottom-0 left-0 right-0 max-h-[70%] rounded-t-3xl p-4 pb-8"
          style={{ backgroundColor: t.surface }}
        >
          <Text className="mb-2 text-lg font-bold" style={{ color: t.ink }}>
            Быстрые ответы
          </Text>
          <FlatList
            data={QUICK_REPLIES}
            keyExtractor={(q) => q.id}
            renderItem={({ item }) => {
              const variant =
                item.variants.find((v) => v.lang === lang) ?? item.variants[0];
              return (
                <Pressable
                  onPress={() => {
                    setDraft((d) => (d ? `${d} ${variant.text}` : variant.text));
                    setQrOpen(false);
                  }}
                  className="border-b py-3 active:opacity-70"
                  style={{ borderColor: t.separator }}
                >
                  <Text
                    className="text-sm font-semibold"
                    style={{ color: t.ink }}
                  >
                    {item.emoji} {item.title}
                  </Text>
                  <Text
                    className="mt-0.5 text-sm"
                    style={{ color: t.sub }}
                    numberOfLines={2}
                  >
                    {variant.text}
                  </Text>
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>

      {/* link client */}
      <Modal visible={linkOpen} transparent animationType="slide" onRequestClose={() => setLinkOpen(false)}>
        <Pressable
          className="flex-1"
          style={{ backgroundColor: t.scrim }}
          onPress={() => setLinkOpen(false)}
        />
        <View
          className="absolute bottom-0 left-0 right-0 h-[70%] rounded-t-3xl"
          style={{ backgroundColor: t.surface }}
        >
          <View className="flex-row items-center justify-between px-4 py-3">
            <Text className="text-lg font-bold" style={{ color: t.ink }}>
              Привязать клиента
            </Text>
            {linkedClient ? (
              <Pressable
                onPress={() => {
                  linkClient.mutate({ chatId: chat.id, clientId: null });
                  setLinkOpen(false);
                }}
              >
                <Text
                  className="text-sm font-medium"
                  style={{ color: t.danger }}
                >
                  Отвязать
                </Text>
              </Pressable>
            ) : null}
          </View>
          <View
            className="mx-4 mb-2 flex-row items-center gap-2 rounded-xl px-3"
            style={{
              backgroundColor: t.dark ? "rgba(255,255,255,0.07)" : "#eef1f5",
            }}
          >
            <Search color={t.faint} size={ICON.sm} />
            <TextInput
              value={clientQuery}
              onChangeText={setClientQuery}
              placeholder="Поиск клиента"
              placeholderTextColor={t.placeholder}
              selectionColor={t.accent}
              keyboardAppearance={t.dark ? "dark" : "light"}
              className="flex-1 py-2 text-base"
              style={{ color: t.ink }}
            />
          </View>
          <FlatList
            data={filteredClients}
            keyExtractor={(c) => c.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  linkClient.mutate({ chatId: chat.id, clientId: item.id });
                  setLinkOpen(false);
                }}
                className="flex-row items-center justify-between px-4 py-3 active:opacity-60"
              >
                <View>
                  <Text className="text-base" style={{ color: t.ink }}>
                    {item.full_name}
                  </Text>
                  {item.phone ? (
                    <Text className="text-sm" style={{ color: t.sub }}>
                      {item.phone}
                    </Text>
                  ) : null}
                </View>
                {chat.client_id === item.id ? (
                  <Star color={t.accent} size={ICON.sm} fill={t.accent} />
                ) : null}
              </Pressable>
            )}
            ItemSeparatorComponent={() => (
              <View
                className="ml-4 h-px"
                style={{ backgroundColor: t.separator }}
              />
            )}
          />
        </View>
      </Modal>
    </Screen>
  );
}
