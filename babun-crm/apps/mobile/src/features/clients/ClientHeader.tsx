// Mobile port of apps/web/src/components/clients/ClientHeader.tsx (web v813).
//
// Poster-style header for the client detail card: name (title), inline
// status badges, phone (with call + message actions — the mobile
// addition over the web's pure-text phone line), debt atom (red, only
// when долг>0) and one grey trust line «{N} визитов · €{LTV} · был {дата}».
//
// Presentational. Receives props from the composer; persists name/phone
// edits via `update`. NativeWind className on core RN components only;
// icons from lucide-react-native (color/size props).

import { useEffect, useState } from "react";
import { Linking, Pressable, Text, TextInput, View } from "react-native";
import {
  Ban,
  Cake,
  Calendar,
  MessageCircle,
  Phone,
  Sparkles,
  Star,
} from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import type { Appointment } from "@babun/shared/local/appointments";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import { formatEUR } from "@babun/shared/common/utils/money";
import { formatShortDateRu, visitsWord } from "@/features/clients/format";
import { Card } from "@/components/ui/Card";
import { useThemeColors } from "@/theme/colors";

interface ClientHeaderProps {
  client: Client;
  appointments: Appointment[];
  stats: ClientStats | undefined;
  update: (patch: Partial<Client>) => void;
}

// ─── Status badges (port of ClientStatusBadges, capped at 3) ──────────
type BadgeSlot = {
  key: string;
  Icon: typeof Star;
  /** chip background className */
  chip: string;
  /** icon color hex */
  color: string;
};

function StatusBadges({
  client,
  stats,
  budget = 3,
}: {
  client: Client;
  stats: ClientStats | undefined;
  budget?: number;
}) {
  const t = useThemeColors();
  type ThemedBadgeSlot = { key: string; Icon: typeof Star; bg: string; color: string };
  const slots: ThemedBadgeSlot[] = [];

  if (client.blacklisted) {
    slots.push({ key: "blacklist", Icon: Ban, bg: `${t.danger}1a`, color: t.danger });
  }
  const bdays = stats?.birthdayInDays ?? null;
  if (bdays !== null && bdays >= 0 && bdays <= 14) {
    slots.push({ key: "birthday", Icon: Cake, bg: `${t.warning}1a`, color: t.warning });
  }
  const naDays = stats?.nextAptDays ?? null;
  if (naDays !== null && naDays >= 0 && naDays <= 7) {
    slots.push({ key: "calendar", Icon: Calendar, bg: `${t.accent}1a`, color: t.accent });
  }
  if (client.tag_ids?.includes("tag-vip")) {
    slots.push({ key: "vip", Icon: Star, bg: t.fill, color: "#b78600" });
  }
  const isNew =
    stats !== undefined && stats.ageDays >= 0 && stats.ageDays < 30 && stats.visits === 0;
  if (isNew) {
    slots.push({ key: "new", Icon: Sparkles, bg: `${t.success}1a`, color: t.success });
  }

  const visible = slots.slice(0, Math.max(0, budget));
  if (visible.length === 0) return null;
  return (
    <View className="flex-row items-center gap-1">
      {visible.map(({ key, Icon, bg, color }) => (
        <View
          key={key}
          className="h-5 w-5 items-center justify-center rounded-full"
          style={{ backgroundColor: bg }}
        >
          <Icon color={color} size={11} strokeWidth={2.5} />
        </View>
      ))}
    </View>
  );
}

// ─── Inline-editable single-line text (tap → edit, save on blur) ──────
function EditableLine({
  value,
  onSave,
  placeholder,
  textClass,
  valueColor,
  keyboardType,
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder: string;
  textClass: string;
  valueColor?: string;
  keyboardType?: "phone-pad" | "default";
}) {
  const t = useThemeColors();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  if (editing) {
    return (
      <TextInput
        autoFocus
        value={draft}
        onChangeText={setDraft}
        keyboardType={keyboardType}
        placeholder={placeholder}
        placeholderTextColor={t.placeholder}
        selectionColor={t.accent}
        keyboardAppearance={t.dark ? "dark" : "light"}
        onBlur={() => {
          setEditing(false);
          if (draft.trim() !== value) onSave(draft.trim());
        }}
        className={`rounded-lg px-2 py-1 ${textClass}`}
        style={{ backgroundColor: t.fill, color: t.ink }}
      />
    );
  }
  return (
    <Pressable
      onPress={() => setEditing(true)}
      accessibilityRole="button"
      accessibilityHint="Нажмите, чтобы изменить"
      hitSlop={{ top: 8, bottom: 8 }}
      className="active:opacity-60"
    >
      <Text style={{ color: value ? (valueColor ?? t.ink) : t.faint }} className={textClass}>
        {value || placeholder}
      </Text>
    </Pressable>
  );
}

export default function ClientHeader({ client, stats, update }: ClientHeaderProps) {
  const t = useThemeColors();
  const phoneDigits = client.phone?.replace(/\D/g, "") ?? "";
  const hasPhone = phoneDigits.length > 0;

  const debt = stats && stats.debt > 0 ? `Долг ${formatEUR(stats.debt)}` : null;
  const trustSegments = (
    stats
      ? [
          stats.visits > 0 ? `${stats.visits} ${visitsWord(stats.visits)}` : null,
          stats.totalSpent > 0 ? formatEUR(stats.totalSpent) : null,
          stats.lastVisitDate ? `был ${formatShortDateRu(stats.lastVisitDate)}` : null,
        ].filter(Boolean)
      : []
  ) as string[];

  return (
    <Card style={{ marginHorizontal: 12, marginTop: 8, padding: 12 }}>
      {/* Name + status badges */}
      <View className="flex-row items-center gap-1.5">
        <View className="flex-1">
          <EditableLine
            value={client.full_name}
            onSave={(v) => update({ full_name: v })}
            placeholder="Имя"
            textClass="text-xl font-bold"
            valueColor={t.ink}
          />
        </View>
        <StatusBadges client={client} stats={stats} budget={3} />
      </View>

      {/* Phone (grey, editable) + call / message actions */}
      <View className="mt-1 flex-row items-center gap-2">
        <View className="flex-1">
          <EditableLine
            value={client.phone}
            onSave={(v) => update({ phone: v })}
            placeholder="Телефон"
            textClass="text-sm"
            valueColor={t.sub}
            keyboardType="phone-pad"
          />
        </View>
        {hasPhone ? (
          <>
            <Pressable
              onPress={() => Linking.openURL(`tel:${phoneDigits}`)}
              className="h-9 w-9 items-center justify-center rounded-lg active:opacity-70"
              style={{ backgroundColor: `${t.success}1a` }}
              accessibilityLabel="Позвонить"
            >
              <Phone color={t.success} size={16} />
            </Pressable>
            <Pressable
              onPress={() => Linking.openURL(`sms:${phoneDigits}`)}
              className="h-9 w-9 items-center justify-center rounded-lg active:opacity-70"
              style={{ backgroundColor: `${t.accent}1a` }}
              accessibilityLabel="Написать"
            >
              <MessageCircle color={t.accent} size={16} />
            </Pressable>
          </>
        ) : null}
      </View>

      {/* Debt atom (red, only when долг>0) */}
      {debt ? (
        <Text className="mt-1.5 text-sm font-semibold" style={{ color: t.danger }}>{debt}</Text>
      ) : null}

      {/* Trust line «N визитов · €LTV · был дата» */}
      {trustSegments.length > 0 ? (
        <Text className="mt-1 text-[13px]" style={{ color: t.sub }}>
          {trustSegments.join(" · ")}
        </Text>
      ) : null}
    </Card>
  );
}
