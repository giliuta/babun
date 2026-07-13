import { FlatList, Linking, Pressable, RefreshControl, Text, View } from "react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import {
  STATUS_LABELS,
  getDebtAmount,
} from "@babun/shared/local/appointments";
import { formatEUR } from "@babun/shared/common/utils/money";
import { parseYMD } from "@/features/appointments/helpers";
import { EmptyState } from "@/components/ui/EmptyState";
import { useThemeColors, type ThemeColors } from "@/theme/colors";

// Agenda («Список») — web AgendaView parity: chronological feed of upcoming
// visits grouped into per-day cards. Day/Week/Month answer «what does today
// look like?»; Agenda answers «what's next on my plate» — dispatchers plan
// routes off it, hence the per-day «Маршрут дня →» maps deep-link.

export interface AgendaSection {
  title: string; // YYYY-MM-DD
  data: Appointment[];
}

export function AgendaView({
  sections,
  todayYmd,
  tomorrowYmd,
  horizonDays,
  clientName,
  serviceSummary,
  onEdit,
  onCreateNew,
  refreshing,
  onRefresh,
}: {
  sections: AgendaSection[];
  /** Business-timezone anchors for the «Сегодня»/«Завтра» headers. */
  todayYmd: string;
  tomorrowYmd: string;
  /** How far the feed looks ahead — only used for the empty-state copy. */
  horizonDays: number;
  clientName: (a: Appointment) => string;
  serviceSummary: (a: Appointment) => string;
  onEdit: (a: Appointment) => void;
  onCreateNew: () => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const t = useThemeColors();
  return (
    <FlatList
      style={{ flex: 1 }}
      data={sections}
      keyExtractor={(s) => s.title}
      contentContainerStyle={{
        padding: 16,
        paddingBottom: 96,
        gap: 16,
        flexGrow: 1,
      }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
      renderItem={({ item }) => (
        <DaySection
          section={item}
          header={headerRu(item.title, todayYmd, tomorrowYmd)}
          clientName={clientName}
          serviceSummary={serviceSummary}
          onEdit={onEdit}
          t={t}
        />
      )}
      ListEmptyComponent={
        <EmptyState
          fill
          title="Записей не запланировано"
          subtitle={`Ближайшие ${horizonDays} дней пусты`}
          action={{ label: "+ Создать запись", onPress: onCreateNew }}
        />
      }
    />
  );
}

function DaySection({
  section,
  header,
  clientName,
  serviceSummary,
  onEdit,
  t,
}: {
  section: AgendaSection;
  header: string;
  clientName: (a: Appointment) => string;
  serviceSummary: (a: Appointment) => string;
  onEdit: (a: Appointment) => void;
  t: ThemeColors;
}) {
  // Beta #54 — maps deep-link with the day's addresses as waypoints, in
  // visit order (web AgendaView). No route optimization (paid quota) — the
  // dispatcher just gets every address pinned in order.
  const addresses = Array.from(
    new Set(
      section.data.map((a) => (a.address || "").trim()).filter(Boolean),
    ),
  );
  const mapsUrl =
    addresses.length > 0
      ? `https://www.google.com/maps/dir/${addresses
          .map((a) => encodeURIComponent(a))
          .join("/")}`
      : null;

  return (
    <View>
      <View className="flex-row items-center justify-between px-2 pb-1">
        <Text
          style={{
            fontSize: 12,
            fontWeight: "600",
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: t.sub,
          }}
        >
          {header}
        </Text>
        {mapsUrl ? (
          <Pressable
            onPress={() => Linking.openURL(mapsUrl)}
            hitSlop={8}
            className="active:opacity-60"
            accessibilityRole="link"
            accessibilityLabel={`Маршрут дня, ${addresses.length} адресов`}
          >
            <Text style={{ fontSize: 11, fontWeight: "600", color: t.accent }}>
              Маршрут дня →
            </Text>
          </Pressable>
        ) : null}
      </View>
      <View
        style={{
          backgroundColor: t.surface,
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: t.cardShadow,
        }}
      >
        {section.data.map((apt, i) => (
          <View key={apt.id}>
            {i > 0 ? (
              <View style={{ height: 1, backgroundColor: t.separator }} />
            ) : null}
            <AgendaRow
              apt={apt}
              clientName={clientName(apt)}
              serviceSummary={serviceSummary(apt)}
              onPress={() => onEdit(apt)}
              t={t}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

function AgendaRow({
  apt,
  clientName,
  serviceSummary,
  onPress,
  t,
}: {
  apt: Appointment;
  clientName: string;
  serviceSummary: string;
  onPress: () => void;
  t: ThemeColors;
}) {
  const statusColor =
    apt.status === "completed"
      ? t.success
      : apt.status === "cancelled"
        ? t.faint
        : apt.status === "in_progress"
          ? t.accent
          : t.sub;
  const cancelled = apt.status === "cancelled";

  // Личное событие — свой шаблон (web design-keeper #6): title из comment,
  // цветная полоска слева, превью заметок — иначе событие выглядело как
  // «битая запись» (Без клиента / €0).
  if (apt.kind === "event" || apt.kind === "personal") {
    const title = apt.comment?.trim() || "Событие";
    const address = apt.address?.trim();
    const notes = apt.event_notes?.trim();
    return (
      <Pressable
        onPress={onPress}
        className="active:opacity-60"
        accessibilityRole="button"
        style={{
          flexDirection: "row",
          gap: 12,
          paddingHorizontal: 16,
          paddingVertical: 12,
          minHeight: 64,
        }}
      >
        <View
          style={{
            position: "absolute",
            left: 0,
            top: 8,
            bottom: 8,
            width: 3,
            borderRadius: 999,
            backgroundColor: apt.color_override || t.warning,
          }}
        />
        <View style={{ width: 64, paddingLeft: 8 }}>
          <Text
            className="tabular-nums"
            style={{ fontSize: 14, fontWeight: "600", color: t.ink }}
          >
            {apt.time_start}
          </Text>
          <Text
            className="tabular-nums"
            style={{ marginTop: 2, fontSize: 11, color: t.faint }}
          >
            {apt.time_end}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={{ fontSize: 14, fontWeight: "600", color: t.ink }}
          >
            {title}
          </Text>
          {address ? (
            <Text
              numberOfLines={1}
              style={{ marginTop: 2, fontSize: 12, color: t.sub }}
            >
              {address}
            </Text>
          ) : null}
          {notes ? (
            <Text
              numberOfLines={1}
              style={{ marginTop: 2, fontSize: 12, color: t.sub }}
            >
              {notes}
            </Text>
          ) : null}
          <Text
            style={{
              marginTop: 2,
              fontSize: 11,
              color: statusColor,
              textDecorationLine: cancelled ? "line-through" : "none",
            }}
          >
            Личное событие
          </Text>
        </View>
      </Pressable>
    );
  }

  const total = apt.total_amount;
  const debt = getDebtAmount(apt);
  return (
    <Pressable
      onPress={onPress}
      className="active:opacity-60"
      accessibilityRole="button"
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        minHeight: 64,
      }}
    >
      <View style={{ width: 64 }}>
        <Text
          className="tabular-nums"
          style={{ fontSize: 14, fontWeight: "600", color: t.ink }}
        >
          {apt.time_start}
        </Text>
        <Text
          className="tabular-nums"
          style={{ marginTop: 2, fontSize: 11, color: t.faint }}
        >
          {apt.time_end}
        </Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{ fontSize: 14, fontWeight: "600", color: t.ink }}
        >
          {clientName || apt.comment || "Без клиента"}
        </Text>
        {serviceSummary ? (
          <Text
            numberOfLines={1}
            style={{ marginTop: 2, fontSize: 12, color: t.sub }}
          >
            {serviceSummary}
          </Text>
        ) : null}
        <Text
          style={{
            marginTop: 2,
            fontSize: 11,
            color: statusColor,
            textDecorationLine: cancelled ? "line-through" : "none",
          }}
        >
          {STATUS_LABELS[apt.status]}
        </Text>
      </View>
      {total > 0 ? (
        <View style={{ alignItems: "flex-end" }}>
          <Text
            className="tabular-nums"
            style={{ fontSize: 14, fontWeight: "600", color: t.ink }}
          >
            {formatEUR(total)}
          </Text>
          {debt > 0 ? (
            <Text
              className="tabular-nums"
              style={{ marginTop: 2, fontSize: 11, color: t.danger }}
            >
              {formatEUR(debt)} к оплате
            </Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

// «Сегодня» / «Завтра» / «Понедельник, 14 июля» — web formatHeaderRu.
function headerRu(ymd: string, todayYmd: string, tomorrowYmd: string): string {
  if (ymd === todayYmd) return "Сегодня";
  if (ymd === tomorrowYmd) return "Завтра";
  const s = parseYMD(ymd).toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
