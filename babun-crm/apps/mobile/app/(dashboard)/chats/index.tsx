import { useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { MessageCircle, Pin, Search } from "lucide-react-native";
import {
  CHANNEL_COLORS,
  CHANNEL_LABELS,
  type Chat,
  type ChatChannel,
} from "@babun/shared/local/chats";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { useChats } from "@/features/chats/store";

// P2 #38 (web chats/page.tsx:286) — no «SMS» chip: SMS is one-way
// (outbound only, no inbox); historical sms-chats still show under «Все».
const CHANNELS: ChatChannel[] = ["whatsapp", "instagram", "telegram"];

type ChatFilter = ChatChannel | "unanswered" | null;

// Web parity (chats/page.tsx:87–90) — «без ответа» = the client spoke
// last and the conversation is still open.
function isUnanswered(c: Chat): boolean {
  const last = c.messages[c.messages.length - 1];
  return last?.direction === "in" && c.status !== "closed" && c.status !== "archived";
}

function lastPreview(c: Chat): string {
  const m = c.messages[c.messages.length - 1];
  if (!m) return "Нет сообщений";
  if (m.content_type === "image") return "📷 Фото";
  if (m.content_type === "audio") return "🎤 Голосовое";
  if (m.content_type === "location") return "📍 Геолокация";
  return m.direction === "out" ? `Вы: ${m.text}` : m.text;
}

function shortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes(),
    ).padStart(2, "0")}`;
  }
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function ChatRow({ c, onPress }: { c: Chat; onPress: () => void }) {
  const t = useThemeColors();
  const color = CHANNEL_COLORS[c.channel] ?? "#6b7280";
  const initial = (c.contact_name || "?").trim().slice(0, 1).toUpperCase();
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center px-4 py-3 active:opacity-60"
    >
      <View
        className="h-12 w-12 items-center justify-center rounded-full"
        style={{ backgroundColor: `${color}22` }}
      >
        <Text className="text-lg font-semibold" style={{ color }}>
          {initial}
        </Text>
      </View>
      <View className="ml-3 flex-1">
        <View className="flex-row items-center justify-between">
          {c.is_pinned ? (
            <Pin
              color={t.faint}
              size={12}
              fill={t.faint}
              style={{ marginRight: 4, transform: [{ rotate: "45deg" }] }}
            />
          ) : null}
          <Text
            className="flex-1 pr-2 text-base font-semibold"
            style={{ color: t.ink }}
            numberOfLines={1}
          >
            {c.contact_name || "Без имени"}
          </Text>
          <Text className="text-xs" style={{ color: t.faint }}>
            {shortTime(c.last_message_at)}
          </Text>
        </View>
        <View className="mt-0.5 flex-row items-center">
          <Text className="text-[11px] font-medium" style={{ color }}>
            {CHANNEL_LABELS[c.channel]}
          </Text>
          <Text className="px-1" style={{ color: t.faint }}>·</Text>
          <Text
            className="flex-1 text-sm"
            style={{ color: t.sub }}
            numberOfLines={1}
          >
            {lastPreview(c)}
          </Text>
          {c.unread_count > 0 ? (
            <View
              className="ml-2 h-5 min-w-[20px] items-center justify-center rounded-full px-1.5"
              style={{ backgroundColor: t.accent }}
            >
              <Text className="text-[11px] font-bold" style={{ color: "#fff" }}>
                {c.unread_count}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export default function ChatsListScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const { data: chats = [], isLoading } = useChats();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ChatFilter>(null);

  const unansweredCount = useMemo(() => chats.filter(isUnanswered).length, [chats]);

  // Web parity (chats/page.tsx:94–118): channel/unanswered filter →
  // archived hidden → search (name, handle, phone, message texts) →
  // pinned-first, then newest.
  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list =
      filter === "unanswered"
        ? chats.filter(isUnanswered)
        : filter
          ? chats.filter((c) => c.channel === filter)
          : chats;
    list = list.filter((c) => c.status !== "archived");
    if (q) {
      list = list.filter(
        (c) =>
          c.contact_name.toLowerCase().includes(q) ||
          c.contact_handle.toLowerCase().includes(q) ||
          c.contact_phone.includes(q) ||
          c.messages.some((m) => m.text.toLowerCase().includes(q)),
      );
    }
    return [...list].sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
      return b.last_message_at.localeCompare(a.last_message_at);
    });
  }, [chats, query, filter]);
  const visibleCount = useMemo(
    () => chats.filter((c) => c.status !== "archived").length,
    [chats],
  );
  const unread = useMemo(
    () => chats.reduce((s, c) => s + c.unread_count, 0),
    [chats],
  );

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        large
        title="Чаты"
        subtitle={`${visibleCount} диалогов${unread > 0 ? ` · ${unread} непрочитанных` : ""}`}
      />

      <View
        className="mx-4 mb-2 flex-row items-center gap-2 rounded-xl px-3"
        style={{ backgroundColor: t.dark ? "rgba(255,255,255,0.07)" : "#eef1f5" }}
      >
        <Search color={t.faint} size={ICON.sm} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Поиск по имени или тексту"
          placeholderTextColor={t.placeholder}
          selectionColor={t.accent}
          keyboardAppearance={t.dark ? "dark" : "light"}
          clearButtonMode="while-editing"
          className="flex-1 py-2.5 text-base"
          style={{ color: t.ink }}
        />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, maxHeight: 48 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8, gap: 8, alignItems: "center" }}
      >
        {([null, "unanswered", ...CHANNELS] as ChatFilter[]).map((ch) => {
          const active = filter === ch;
          const waiting = ch === "unanswered";
          const color = waiting ? t.warning : ch ? CHANNEL_COLORS[ch] : t.accent;
          // «Без ответа» is the operator's work queue — show the count
          // and a warning tint while it's non-empty (web parity).
          const label = waiting
            ? unansweredCount > 0 || active
              ? `Без ответа (${unansweredCount})`
              : "Без ответа"
            : ch
              ? CHANNEL_LABELS[ch]
              : "Все";
          const idleTint = waiting && unansweredCount > 0;
          return (
            <Pressable
              key={ch ?? "all"}
              onPress={() => setFilter(ch)}
              className="rounded-full px-3.5 py-1.5"
              style={{
                backgroundColor: active
                  ? color
                  : idleTint
                    ? `${t.warning}24`
                    : t.dark
                      ? "rgba(255,255,255,0.07)"
                      : "#eef1f5",
              }}
            >
              <Text
                className="text-sm font-medium"
                style={{ color: active ? "#fff" : idleTint ? t.warning : t.body }}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {isLoading ? (
        <EmptyState state="loading" fill />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={sorted}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ flexGrow: 1 }}
          renderItem={({ item }) => (
            <ChatRow c={item} onPress={() => router.push(`/chats/${item.id}`)} />
          )}
          ItemSeparatorComponent={() => (
            <View
              className="ml-[68px] h-px"
              style={{ backgroundColor: t.separator }}
            />
          )}
          ListEmptyComponent={
            <EmptyState
              fill
              icon={<MessageCircle color={t.faint} size={40} strokeWidth={1.6} />}
              title="Нет диалогов"
              subtitle={
                filter || query.trim()
                  ? "Попробуйте другой фильтр или обнулите поиск."
                  : "Подключите WhatsApp / Instagram / Telegram, чтобы вести переписку с клиентами в одном месте."
              }
            />
          }
        />
      )}
    </Screen>
  );
}
