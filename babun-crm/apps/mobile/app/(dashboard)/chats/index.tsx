import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FlatList, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import { Archive, Clock, MessageCircle, Pin, Search } from "lucide-react-native";
import {
  CHANNEL_COLORS,
  CHANNEL_LABELS,
  type Chat,
  type ChatChannel,
} from "@babun/shared/local/chats";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import {
  useChats,
  useSeedDemoChats,
  useSetChatStatus,
  useTogglePin,
} from "@/features/chats/store";

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

// SLA badge — elapsed time since the client's last unanswered message
// (web WaitingBadge, chats/page.tsx:877–907). Escalates: faint < 1h,
// warning 1–4h, danger > 4h. Hidden under 30 minutes.
function slaOf(
  c: Chat,
  now: number,
): { label: string; tier: "faint" | "warning" | "danger" } | null {
  if (!isUnanswered(c)) return null;
  const last = c.messages[c.messages.length - 1];
  if (!last) return null;
  const mins = Math.floor((now - new Date(last.timestamp).getTime()) / 60000);
  if (mins < 30) return null;
  const label =
    mins < 60 ? `${mins}м` : mins < 1440 ? `${Math.floor(mins / 60)}ч` : `${Math.floor(mins / 1440)}д`;
  return { label, tier: mins > 240 ? "danger" : mins > 60 ? "warning" : "faint" };
}

// Swipe action panel (leading = pin, trailing = archive; web
// chats/page.tsx:320–326). Fixed 88pt wide, full-height tap target.
function SwipeAction({
  icon,
  label,
  color,
  onPress,
}: {
  icon: ReactNode;
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="w-[88px] items-center justify-center gap-1"
      style={{ backgroundColor: color }}
    >
      {icon}
      <Text className="text-[11px] font-semibold" style={{ color: "#fff" }}>
        {label}
      </Text>
    </Pressable>
  );
}

function ChatRow({
  c,
  now,
  onPress,
  onTogglePin,
  onArchive,
}: {
  c: Chat;
  now: number;
  onPress: () => void;
  onTogglePin: () => void;
  onArchive: () => void;
}) {
  const t = useThemeColors();
  const swipeRef = useRef<SwipeableMethods | null>(null);
  const color = CHANNEL_COLORS[c.channel] ?? "#6b7280";
  const title = c.contact_name || c.contact_handle || "Без имени";
  const initial = title.trim().slice(0, 1).toUpperCase();
  const sla = slaOf(c, now);
  const slaColor =
    sla?.tier === "danger" ? t.danger : sla?.tier === "warning" ? t.warning : t.faint;
  const pinLabel = c.is_pinned ? "Открепить" : "Закрепить";
  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      friction={2}
      leftThreshold={44}
      rightThreshold={44}
      overshootLeft={false}
      overshootRight={false}
      renderLeftActions={() => (
        <SwipeAction
          icon={<Pin color="#fff" size={ICON.sm} />}
          label={pinLabel}
          color={t.accent}
          onPress={() => {
            swipeRef.current?.close();
            onTogglePin();
          }}
        />
      )}
      renderRightActions={() => (
        <SwipeAction
          icon={<Archive color="#fff" size={ICON.sm} />}
          label="Архив"
          color={t.warning}
          onPress={() => {
            swipeRef.current?.close();
            onArchive();
          }}
        />
      )}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${CHANNEL_LABELS[c.channel]}${
          c.unread_count > 0 ? `, непрочитанных: ${c.unread_count}` : ""
        }`}
        // Screen-reader path to the swipe actions.
        accessibilityActions={[
          { name: "pin", label: pinLabel },
          { name: "archive", label: "В архив" },
        ]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === "pin") onTogglePin();
          if (e.nativeEvent.actionName === "archive") onArchive();
        }}
        className="flex-row items-center px-4 py-3 active:opacity-60"
        style={{ backgroundColor: t.canvas }}
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
              {title}
            </Text>
            {sla ? (
              <View className="mr-1.5 flex-row items-center gap-0.5">
                <Clock color={slaColor} size={11} />
                <Text
                  className="text-xs"
                  style={{
                    color: slaColor,
                    fontWeight: sla.tier === "danger" ? "700" : "400",
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {sla.label}
                </Text>
              </View>
            ) : null}
            <Text className="text-xs" style={{ color: t.faint }}>
              {shortTime(c.last_message_at)}
            </Text>
          </View>
          <View className="mt-0.5 flex-row items-center">
            <Text className="text-[11px] font-medium" style={{ color }}>
              {CHANNEL_LABELS[c.channel]}
            </Text>
            <Text className="px-1" style={{ color: t.faint }}>·</Text>
            {c.draft ? (
              // Web parity (chats/page.tsx:367–368) — unsent draft beats
              // the last-message preview and warns in red.
              <Text
                className="flex-1 text-sm"
                style={{ color: t.danger }}
                numberOfLines={1}
              >
                Черновик: {c.draft}
              </Text>
            ) : (
              <Text
                className="flex-1 text-sm"
                style={{ color: t.sub }}
                numberOfLines={1}
              >
                {lastPreview(c)}
              </Text>
            )}
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
    </ReanimatedSwipeable>
  );
}

export default function ChatsListScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const { data: chats = [], isLoading } = useChats();
  const seedDemo = useSeedDemoChats();
  const togglePin = useTogglePin();
  const setStatus = useSetChatStatus();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ChatFilter>(null);

  // Single per-screen minute tick drives every row's SLA badge.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

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
  // Per-channel counts for the chips (web chats/page.tsx:296–298).
  const channelCounts = useMemo(() => {
    const m = new Map<ChatChannel, number>();
    for (const c of chats) {
      if (c.status === "archived") continue;
      m.set(c.channel, (m.get(c.channel) ?? 0) + 1);
    }
    return m;
  }, [chats]);

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        large
        title="Чаты"
        subtitle={`${visibleCount} диалогов${unread > 0 ? ` · ${unread} непрочитанных` : ""}`}
      />

      <View
        className="mx-4 mb-2 flex-row items-center gap-2 rounded-xl px-3"
        style={{ backgroundColor: t.fill }}
      >
        <Search color={t.faint} size={ICON.sm} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Имя, телефон, @handle или текст"
          placeholderTextColor={t.placeholder}
          selectionColor={t.accent}
          keyboardAppearance={t.dark ? "dark" : "light"}
          clearButtonMode="while-editing"
          accessibilityLabel="Поиск по чатам"
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
          // Counts in chips — web parity (chats/page.tsx:294–309): «Все»
          // always shows its count (canonical total); «Без ответа» and the
          // channels only when > 0 or active, so a first-time user doesn't
          // see a row of «(0)» noise.
          const count = waiting
            ? unansweredCount
            : ch
              ? (channelCounts.get(ch) ?? 0)
              : visibleCount;
          const showCount = !ch || count > 0 || active;
          const label = !ch ? "Все" : waiting ? "Без ответа" : CHANNEL_LABELS[ch];
          const idleTint = waiting && unansweredCount > 0;
          return (
            <Chip
              key={ch ?? "all"}
              label={label}
              count={showCount ? count : undefined}
              radio
              selected={active}
              color={color}
              idleColor={idleTint ? t.warning : undefined}
              onPress={() => setFilter(ch)}
            />
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
            <ChatRow
              c={item}
              now={now}
              onPress={() => router.push(`/chats/${item.id}`)}
              onTogglePin={() => togglePin.mutate(item.id)}
              onArchive={() =>
                setStatus.mutate({ chatId: item.id, status: "archived" })
              }
            />
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
              // Честный текст: кнопки «подключить» пока нет — не обещаем
              // действие, которое некуда нажать.
              subtitle={
                filter || query.trim()
                  ? "Попробуйте другой фильтр или обнулите поиск."
                  : "Здесь появятся диалоги из WhatsApp, Instagram и Telegram после подключения каналов — оно скоро появится."
              }
              // STORY-053a — demo data strictly ON REQUEST (auto-seed was
              // removed in Wave 1): explicit button, only on a truly empty
              // inbox (no chats at all, not just a filtered-out view).
              action={
                !filter && !query.trim() && chats.length === 0
                  ? {
                      label: "Загрузить демо-чаты",
                      onPress: () => seedDemo.mutate(),
                    }
                  : undefined
              }
            />
          }
        />
      )}
    </Screen>
  );
}
