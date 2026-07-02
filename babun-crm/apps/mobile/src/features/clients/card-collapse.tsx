// card-collapse — the collapsed «reference» shell of the client card
// (LOCKED client-app.html mockup, .ref rows: label quiet · value loud ·
// chevron). Every reference block (Визиты / Финансы / Заметки / Вложения /
// Контакты / Личное / Метаданные) wraps its content in this card:
// collapsed by default, one tap expands the full block inline. Children
// mount only while open, so a card with 50 visit rows costs nothing until
// the user asks for it.

import { useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { useThemeColors } from "@/theme/colors";

interface CollapsibleCardProps {
  /** Quiet row label, e.g. «Финансы». */
  title: string;
  /** Loud right-side summary, e.g. «долг €135» / «8 · был 10 мая». */
  summary?: string;
  /** danger → red summary (долг). muted → grey regular (заметки/«—»). */
  tone?: "default" | "danger" | "muted";
  defaultOpen?: boolean;
  children: ReactNode;
}

export function CollapsibleCard({
  title,
  summary,
  tone = "default",
  defaultOpen = false,
  children,
}: CollapsibleCardProps) {
  const t = useThemeColors();
  const [open, setOpen] = useState(defaultOpen);

  const value = summary || "—";
  const valueColor =
    tone === "danger" ? t.danger : tone === "muted" || !summary ? t.sub : t.ink;
  const valueWeight = tone === "muted" || !summary ? "font-normal" : "font-semibold";
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <View
      className="mx-3 mt-2 overflow-hidden rounded-2xl shadow-sm"
      style={{ backgroundColor: t.surface }}
    >
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        className="min-h-[48px] flex-row items-center gap-2.5 px-4 py-3 active:opacity-70"
      >
        <Text className="text-[13px]" style={{ color: t.sub }}>
          {title}
        </Text>
        <Text
          className={`flex-1 text-right text-[15px] ${valueWeight}`}
          style={{ color: valueColor }}
          numberOfLines={1}
        >
          {value}
        </Text>
        <Chevron color={t.chevron} size={16} strokeWidth={2.2} />
      </Pressable>

      {open ? (
        <View
          className="px-3 pb-3 pt-1"
          style={{ borderTopWidth: 1, borderTopColor: t.separator }}
        >
          {children}
        </View>
      ) : null}
    </View>
  );
}
