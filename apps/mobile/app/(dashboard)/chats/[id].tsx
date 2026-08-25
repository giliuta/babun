import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Clipboard,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useBookingNav } from "@/features/clients/card-booking";
import {
  Archive,
  Calendar,
  Check,
  CheckCheck,
  Copy,
  CornerUpLeft,
  EllipsisVertical,
  Link2,
  MessageSquareText,
  Pin,
  Search,
  Send,
  Star,
  Trash2,
  UserRound,
  X,
} from "lucide-react-native";
import {
  CHANNEL_LABELS,
  type ChatMessage,
  type MessageStatus,
} from "@babun/shared/local/chats";
import {
  detectLanguage,
  QUICK_REPLIES,
} from "@babun/shared/common/utils/quick-replies";
import { renderTemplate } from "@babun/shared/local/sms-templates";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { useClients, useCreateClient } from "@/features/clients/queries";
import { tryToE164 } from "@/features/clients/phone";
import { useSmsTemplates } from "@/features/settings/sms-templates";
import { useTenant } from "@/features/settings/tenant";
import { notify } from "@/lib/notify";
import { chooseOption } from "@/lib/choose";
import {
  useChat,
  useDeleteMessage,
  useLinkClient,
  useMarkRead,
  usePersistDraft,
  useSendMessage,
  useSetChatStatus,
  useStarMessage,
  useTogglePin,
} from "@/features/chats/store";

function msgTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

// «Сегодня / Вчера / 5 марта» — web parity (chats/page.tsx:863–871),
// including the ISO-slice date key so both platforms bucket identically.
function formatDateLabel(dateKey: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (dateKey === today) return "Сегодня";
  if (dateKey === yesterday) return "Вчера";
  const [, m, d] = dateKey.split("-").map(Number);
  const months = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
  return `${d} ${months[m - 1]}`;
}

function bodyOf(m: ChatMessage): string {
  if (m.content_type === "image") return "📷 Фото";
  if (m.content_type === "audio") return "🎤 Голосовое";
  if (m.content_type === "location") return "📍 Геолокация";
  return m.text;
}

// Delivery ticks for outgoing messages — web StatusChecks
// (chats/page.tsx:820–831): ✓ sent, ✓✓ delivered, ✓✓ accent when read.
function StatusTicks({ status }: { status?: MessageStatus }) {
  const t = useThemeColors();
  if (!status) return null;
  const Icon = status === "sent" ? Check : CheckCheck;
  return (
    <Icon
      color={status === "read" ? t.accent : t.faint}
      size={13}
      strokeWidth={2.4}
    />
  );
}

// Rows of the inverted thread list: date separators interleaved with
// messages (web groups by day, chats/page.tsx:615–621).
type ThreadRow =
  | { type: "date"; key: string; label: string }
  | { type: "msg"; m: ChatMessage };

// Memoized bubble — message objects are referentially stable across
// composer keystrokes, so typing doesn't re-render the visible thread.
const MessageRow = memo(function MessageRow({
  m,
  quoted,
  onLongPress,
  onCopy,
}: {
  m: ChatMessage;
  quoted: ChatMessage | null;
  onLongPress: (m: ChatMessage) => void;
  onCopy: (m: ChatMessage) => void;
}) {
  const t = useThemeColors();
  const out = m.direction === "out";
  return (
    <Pressable
      onLongPress={() => onLongPress(m)}
      accessibilityRole="button"
      accessibilityLabel={`${out ? "Вы" : "Клиент"}: ${bodyOf(m)}, ${msgTime(m.timestamp)}`}
      accessibilityHint="Долгое нажатие — меню сообщения"
      // Screen-reader path to the long-press menu and to copy.
      accessibilityActions={[
        { name: "longpress", label: "Меню сообщения" },
        { name: "copy", label: "Копировать" },
      ]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === "copy") onCopy(m);
        else onLongPress(m);
      }}
      className={`my-0.5 min-h-11 max-w-[82%] justify-center ${out ? "self-end" : "self-start"}`}
    >
      <View
        className="rounded-[10px] px-3.5 py-2"
        style={{
          backgroundColor: out
            ? t.accent
            : t.fill,
        }}
      >
        {quoted ? (
          <View
            className="mb-1 rounded-[10px] border-l-2 px-2 py-1"
            style={{
              borderColor: out ? "rgba(255,255,255,0.6)" : t.accent,
              backgroundColor: out
                ? "rgba(11,18,32,0.18)"
                : "rgba(11,18,32,0.05)",
            }}
          >
            <Text
              className="text-[11px]"
              style={{ color: out ? t.onAccent : t.sub }}
              numberOfLines={1}
            >
              {bodyOf(quoted)}
            </Text>
          </View>
        ) : null}
        {/* Web parity (page.tsx): a photo message renders the actual image
            plus its caption text; only non-photo messages fall back to the
            bodyOf placeholder («📷 Фото» stays for the list preview only). */}
        {m.photo ? (
          <Image
            source={{ uri: m.photo }}
            style={{
              width: 200,
              height: 200,
              borderRadius: t.radius.card,
              marginBottom: m.text ? 4 : 0,
            }}
            resizeMode="cover"
            accessibilityLabel="Фото"
          />
        ) : null}
        {m.photo && !m.text ? null : (
          <Text className="text-base" style={{ color: out ? "#fff" : t.ink }}>
            {m.photo ? m.text : bodyOf(m)}
          </Text>
        )}
      </View>
      <View className={`mt-0.5 flex-row items-center gap-1 px-1 ${out ? "justify-end" : ""}`}>
        {m.is_starred ? (
          <Star color={t.warning} size={11} fill={t.warning} />
        ) : null}
        <Text className="text-[10px]" style={{ color: t.faint }}>
          {msgTime(m.timestamp)}
        </Text>
        {out ? <StatusTicks status={m.status} /> : null}
      </View>
    </Pressable>
  );
});

function DateSeparator({ label }: { label: string }) {
  const t = useThemeColors();
  return (
    <View className="my-2 items-center">
      <View
        className="rounded-full px-3 py-1"
        style={{
          backgroundColor: "rgba(11,18,32,0.06)",
        }}
      >
        <Text className="text-xs font-medium" style={{ color: t.sub }}>
          {label}
        </Text>
      </View>
    </View>
  );
}

export default function ChatThreadScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const book = useBookingNav();
  const { id } = useLocalSearchParams<{ id: string }>();
  const chat = useChat(id);
  const { data: clients = [] } = useClients();
  const toast = useToast();

  const send = useSendMessage();
  const star = useStarMessage();
  const del = useDeleteMessage();
  const persistDraft = usePersistDraft();
  const linkClient = useLinkClient();
  const markRead = useMarkRead();
  const togglePin = useTogglePin();
  const setStatus = useSetChatStatus();
  const createClient = useCreateClient();
  const { data: smsTemplates = [] } = useSmsTemplates();
  const { data: tenant } = useTenant();

  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [menuMsg, setMenuMsg] = useState<ChatMessage | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  // Template palette tab: built-in quick replies vs the user's own
  // SMS templates (Кабинет → SMS-шаблоны).
  const [qrTab, setQrTab] = useState<"quick" | "sms">("quick");
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
  // whole thread to render on open). Date separators are interleaved
  // BEFORE reversing, so each label ends up visually above its day.
  const rows = useMemo<ThreadRow[]>(() => {
    const out: ThreadRow[] = [];
    let lastDate = "";
    for (const m of chat?.messages ?? []) {
      const dateKey = m.timestamp.slice(0, 10);
      if (dateKey !== lastDate) {
        out.push({ type: "date", key: `d-${dateKey}`, label: formatDateLabel(dateKey) });
        lastDate = dateKey;
      }
      out.push({ type: "msg", m });
    }
    out.reverse();
    return out;
  }, [chat?.messages]);
  const lang = useMemo(
    () => detectLanguage((chat?.messages ?? []).map((m) => m.text)),
    [chat?.messages],
  );
  const linkedClient = chat?.client_id
    ? clients.find((c) => c.id === chat.client_id)
    : null;

  // The user's own SMS templates as composer inserts. [Имя]/[Компания]
  // are substituted right away (linked client beats the raw contact
  // name); appointment tokens ([Дата], [Время], [Мастер]…) have no
  // value in a chat context and stay literal — renderTemplate keeps
  // unresolved tokens visible so the operator fills them before send.
  const smsInserts = useMemo(() => {
    const name = (linkedClient?.full_name || chat?.contact_name || "").trim();
    const vars: Record<string, string> = {};
    if (name) vars.Name = name;
    if (tenant?.name) vars.Company = tenant.name;
    return smsTemplates
      .filter((tpl) => tpl.enabled)
      .map((tpl) => ({ ...tpl, rendered: renderTemplate(tpl.body, vars) }));
  }, [smsTemplates, linkedClient?.full_name, chat?.contact_name, tenant?.name]);

  const copyMessage = useCallback(
    (m: ChatMessage) => {
      // RN core Clipboard (deprecated upstream, still shipped in 0.81) —
      // expo-clipboard isn't in deps and new packages are frozen.
      Clipboard.setString(m.text || bodyOf(m));
      toast("Скопировано");
      setMenuMsg(null);
    },
    [toast],
  );

  // Above the early return — hook order must not depend on `chat`.
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

  if (!chat) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Чат" />
        <EmptyState fill title="Диалог не найден" />
      </Screen>
    );
  }

  const title = chat.contact_name || chat.contact_handle || "Без имени";
  const subtitleParts = [
    CHANNEL_LABELS[chat.channel],
    chat.contact_name ? chat.contact_handle : "",
    linkedClient?.full_name ?? "",
  ].filter(Boolean);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    send.mutate({ chatId: chat.id, text, replyToId: replyTo?.id ?? null });
    setReplyTo(null);
  };

  // «чат → клиент → запись». Раньше шло ЧЕРЕЗ таб «Календарь» (?new=1):
  // человек видел вспышку чужого календаря, у него подменялись день и
  // команда, а после «Готово» он оставался в календаре, потеряв чат. Теперь
  // экран записи открывается напрямую и возвращает в тот же диалог.
  const bookClient = (clientId?: string | null) => {
    if (!clientId) return;
    book({ clientId });
  };

  // ⋮ «Создать клиента» — web opens CreateClientModal prefilled with the
  // dialog contact (name always, phone only for whatsapp/sms — page.tsx:
  // 566–572; name is the only required field there). Mobile creates the
  // client directly after a confirm, links it to the chat and lands on
  // the client card (add-client decision: create IS the client card).
  // «…и записать» continues the daily chain straight into the calendar.
  const createFromChat = () => {
    const phone =
      chat.channel === "whatsapp" || chat.channel === "sms"
        ? chat.contact_phone.trim()
        : "";
    const name = (chat.contact_name || chat.contact_handle).trim();
    if (!name && !phone) {
      // Nothing to prefill — hand over to the regular create screen.
      router.push("/clients/new");
      return;
    }

    // Dedup guard (web's «existing» tab): same E.164 → offer to link.
    const e164 = phone ? tryToE164(phone) : null;
    const existing = e164
      ? clients.find((c) => (c.phone_e164 ?? tryToE164(c.phone ?? "")) === e164)
      : undefined;
    if (existing) {
      void chooseOption(
        "Клиент уже существует",
        [{ label: "Привязать" }, { label: "Привязать и записать" }],
        {
          message: `${existing.full_name || existing.phone}${existing.phone ? ` · ${existing.phone}` : ""}`,
        },
      ).then((index) => {
        if (index === null) return;
        linkClient.mutate({ chatId: chat.id, clientId: existing.id });
        if (index === 0) toast("Клиент привязан");
        else bookClient(existing.id);
      });
      return;
    }

    const doCreate = async (book: boolean) => {
      try {
        const created = await createClient.mutateAsync({
          full_name: name,
          phone,
          phone_e164: e164,
        });
        linkClient.mutate({ chatId: chat.id, clientId: created.id });
        if (book) bookClient(created.id);
        else router.push(`/clients/${created.id}`);
      } catch (e) {
        // useCreateClient is meta.errorHandled — alerting is on us.
        notify(
          "Не удалось создать клиента",
          (e as Error).message || "Проверьте соединение и попробуйте ещё раз.",
        );
      }
    };
    void chooseOption(
      "Создать клиента",
      [{ label: "Создать" }, { label: "Создать и записать" }],
      { message: [name, phone].filter(Boolean).join(" · ") },
    ).then((index) => {
      if (index !== null) void doCreate(index === 1);
    });
  };

  // ⋮ menu — web header menu semantics (chats/page.tsx:649–674).
  // Linking lives here as labeled rows (стандарт «добавить»: no bare
  // glyphs in headers — the old unlabeled Link2 icon moved into ⋮).
  const headerActions: {
    label: string;
    icon: typeof Pin;
    danger?: boolean;
    onPress: () => void;
  }[] = [
    {
      label: chat.is_pinned ? "Открепить" : "Закрепить",
      icon: Pin,
      onPress: () => togglePin.mutate(chat.id),
    },
    ...(linkedClient
      ? [
          {
            label: "Открыть карточку клиента",
            icon: UserRound,
            onPress: () => router.push(`/clients/${linkedClient.id}`),
          },
          {
            label: "Сменить клиента",
            icon: Link2,
            onPress: () => setLinkOpen(true),
          },
        ]
      : [
          {
            label: "Создать клиента",
            icon: UserRound,
            onPress: createFromChat,
          },
          {
            label: "Привязать клиента",
            icon: Link2,
            onPress: () => setLinkOpen(true),
          },
        ]),
    {
      label: "Записать на приём",
      icon: Calendar,
      onPress: () => bookClient(chat.client_id),
    },
    {
      label: "Закрыть чат",
      icon: Check,
      onPress: () => {
        setStatus.mutate({ chatId: chat.id, status: "closed" });
        toast("Чат закрыт");
      },
    },
    {
      label: "В архив",
      icon: Archive,
      onPress: () => {
        setStatus.mutate({ chatId: chat.id, status: "archived" });
        router.back();
      },
    },
  ];

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        title={title}
        subtitle={subtitleParts.join(" · ")}
        right={
          <Pressable
            onPress={() => setHeaderMenuOpen(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Меню диалога"
            className="h-10 w-10 items-center justify-center rounded-full active:opacity-60"
          >
            <EllipsisVertical color={t.body} size={ICON.sm} />
          </Pressable>
        }
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <FlatList
          style={{ flex: 1 }}
          data={rows}
          // Only invert when there are messages — an inverted empty list
          // would render ListEmptyComponent upside down.
          inverted={rows.length > 0}
          keyExtractor={(r) => (r.type === "date" ? r.key : r.m.id)}
          contentContainerStyle={{ padding: 12, flexGrow: 1 }}
          renderItem={({ item }) =>
            item.type === "date" ? (
              <DateSeparator label={item.label} />
            ) : (
              <MessageRow
                m={item.m}
                quoted={
                  item.m.reply_to_id ? (byId.get(item.m.reply_to_id) ?? null) : null
                }
                onLongPress={setMenuMsg}
                onCopy={copyMessage}
              />
            )
          }
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
            <Pressable
              onPress={() => setReplyTo(null)}
              accessibilityRole="button"
              accessibilityLabel="Отменить ответ"
              className="h-11 w-11 items-center justify-center rounded-full active:opacity-60"
            >
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
            accessibilityRole="button"
            accessibilityLabel="Шаблоны"
            className="h-11 w-11 items-center justify-center rounded-full active:opacity-60"
          >
            <MessageSquareText color={t.accent} size={ICON.sm} />
          </Pressable>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onBlur={() => persistDraft(chat.id, draft)}
            placeholder="Сообщение…"
            placeholderTextColor={t.placeholder}
            selectionColor={t.accent}
            keyboardAppearance="light"
            multiline
            accessibilityLabel="Текст сообщения"
            className="max-h-24 flex-1 rounded-[10px] px-4 py-2.5 text-base"
            style={{
              backgroundColor: t.fill,
              color: t.ink,
            }}
          />
          <Pressable
            onPress={submit}
            disabled={!draft.trim()}
            accessibilityRole="button"
            accessibilityLabel="Отправить"
            accessibilityState={{ disabled: !draft.trim() }}
            className={`h-11 w-11 items-center justify-center rounded-full ${draft.trim() ? "active:opacity-80" : ""}`}
            style={{ backgroundColor: draft.trim() ? t.accent : t.disabledFill }}
          >
            <Send color="#fff" size={18} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {/* header ⋮ menu */}
      <Modal
        visible={headerMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setHeaderMenuOpen(false)}
      >
        <Pressable
          className="flex-1 justify-end"
          style={{ backgroundColor: t.scrim }}
          onPress={() => setHeaderMenuOpen(false)}
          accessible={false}
        >
          <View
            className="m-3 overflow-hidden rounded-[10px]"
            style={{ backgroundColor: t.surface }}
          >
            {headerActions.map((a, i) => (
              <Pressable
                key={a.label}
                onPress={() => {
                  setHeaderMenuOpen(false);
                  a.onPress();
                }}
                accessibilityRole="button"
                accessibilityLabel={a.label}
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

      {/* message context menu */}
      <Modal visible={!!menuMsg} transparent animationType="fade" onRequestClose={() => setMenuMsg(null)}>
        <Pressable
          className="flex-1 justify-end"
          style={{ backgroundColor: t.scrim }}
          onPress={() => setMenuMsg(null)}
          accessible={false}
        >
          <View
            className="m-3 overflow-hidden rounded-[10px]"
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
              // Web parity (chats/page.tsx:750) — copy sits between
              // reply and star in the long-press menu.
              {
                label: "Копировать",
                icon: Copy,
                onPress: () => {
                  if (menuMsg) copyMessage(menuMsg);
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
                accessibilityRole="button"
                accessibilityLabel={a.label}
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
          accessible={false}
        />
        <View
          className="absolute bottom-0 left-0 right-0 max-h-[70%] rounded-t-[10px] p-4 pb-8"
          style={{ backgroundColor: t.surface }}
        >
          <Text className="mb-2 text-lg font-bold" style={{ color: t.ink }}>
            Шаблоны
          </Text>
          {/* Two palettes in one sheet: built-in multilingual quick
              replies + the user's SMS templates with [Имя] pre-filled
              (Кабинет → SMS-шаблоны). */}
          <SegmentedControl
            options={[
              { value: "quick", label: "Быстрые ответы" },
              { value: "sms", label: "SMS-шаблоны" },
            ]}
            value={qrTab}
            onChange={setQrTab}
            style={{ marginBottom: 8 }}
          />
          {qrTab === "quick" ? (
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
                    accessibilityRole="button"
                    accessibilityLabel={`Шаблон: ${item.title}`}
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
          ) : (
            <FlatList
              data={smsInserts}
              keyExtractor={(tpl) => tpl.id}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    setDraft((d) => (d ? `${d} ${item.rendered}` : item.rendered));
                    setQrOpen(false);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Шаблон: ${item.name}`}
                  className="border-b py-3 active:opacity-70"
                  style={{ borderColor: t.separator }}
                >
                  <Text
                    className="text-sm font-semibold"
                    style={{ color: t.ink }}
                  >
                    {item.name}
                  </Text>
                  <Text
                    className="mt-0.5 text-sm"
                    style={{ color: t.sub }}
                    numberOfLines={2}
                  >
                    {item.rendered}
                  </Text>
                </Pressable>
              )}
              ListEmptyComponent={
                <View className="items-center py-6">
                  <Text className="text-sm" style={{ color: t.sub }}>
                    Нет включённых SMS-шаблонов
                  </Text>
                  <Pressable
                    onPress={() => {
                      setQrOpen(false);
                      router.push("/cabinet/sms-templates" as Href);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Настроить SMS-шаблоны"
                    className="mt-1 min-h-[44px] items-center justify-center px-4 active:opacity-60"
                  >
                    <Text
                      className="text-base font-semibold"
                      style={{ color: t.accent }}
                    >
                      Настроить шаблоны
                    </Text>
                  </Pressable>
                </View>
              }
            />
          )}
        </View>
      </Modal>

      {/* link client */}
      <Modal visible={linkOpen} transparent animationType="slide" onRequestClose={() => setLinkOpen(false)}>
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
        <Pressable
          className="flex-1"
          style={{ backgroundColor: t.scrim }}
          onPress={() => setLinkOpen(false)}
          accessible={false}
        />
        <View
          className="h-[70%] rounded-t-[10px]"
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
                accessibilityRole="button"
                accessibilityLabel="Отвязать клиента"
                className="min-h-11 justify-center px-2 active:opacity-60"
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
            className="mx-4 mb-2 flex-row items-center gap-2 rounded-[10px] px-3"
            style={{
              backgroundColor: t.fill,
            }}
          >
            <Search color={t.faint} size={ICON.sm} />
            <TextInput
              value={clientQuery}
              onChangeText={setClientQuery}
              placeholder="Поиск клиента"
              placeholderTextColor={t.placeholder}
              selectionColor={t.accent}
              keyboardAppearance="light"
              accessibilityLabel="Поиск клиента"
              className="flex-1 py-2 text-base"
              style={{ color: t.ink }}
            />
          </View>
          {/* Инлайн-создание по стандарту «добавить» (labeled, не голый
              глиф): клиента нет в списке → создаём из контакта чата, не
              выходя из сценария (createFromChat сам дедупит и линкует). */}
          <Pressable
            onPress={() => {
              setLinkOpen(false);
              createFromChat();
            }}
            accessibilityRole="button"
            accessibilityLabel="Новый клиент из этого чата"
            className="min-h-[52px] flex-row items-center gap-3 border-b px-4 active:opacity-60"
            style={{ borderColor: t.separator }}
          >
            <View
              className="h-7 w-7 items-center justify-center rounded-full"
              style={{ backgroundColor: `${t.accent}1A` }}
            >
              <UserRound color={t.accent} size={16} strokeWidth={2.4} />
            </View>
            <Text className="text-base font-medium" style={{ color: t.accent }}>
              Новый клиент из этого чата
            </Text>
          </Pressable>
          <FlatList
            data={filteredClients}
            keyExtractor={(c) => c.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  linkClient.mutate({ chatId: chat.id, clientId: item.id });
                  setLinkOpen(false);
                  toast("Клиент привязан");
                }}
                accessibilityRole="button"
                accessibilityLabel={`Привязать: ${item.full_name}`}
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
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}
