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
import type { BlockKind } from "@babun/shared/local/business-blocks";
import { getStorage } from "@babun/shared/storage";
import { Card } from "@/components/ui/Card";
import { useThemeColors } from "@/theme/colors";

// Open-state persistence — MMKV mirror of the web localStorage contract
// (shared business-blocks.ts getBlockOpen/setBlockOpen use window.localStorage
// directly, which doesn't exist on native): global per-kind key, not
// per-client, to avoid 6300+ keys at 900-client scale.
const OPEN_KEY = (kind: BlockKind) => `babun-block-open:${kind}`;

function readBlockOpen(kind: BlockKind | undefined, fallback: boolean): boolean {
  if (!kind) return fallback;
  try {
    const raw = getStorage().getRaw(OPEN_KEY(kind));
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    // MMKV may throw while the Keychain is locked — fallback wins.
  }
  return fallback;
}

function writeBlockOpen(kind: BlockKind | undefined, open: boolean): void {
  if (!kind) return;
  try {
    getStorage().setRaw(OPEN_KEY(kind), open ? "1" : "0");
  } catch {
    // cache only
  }
}

interface CollapsibleCardProps {
  /** Quiet row label, e.g. «Финансы». */
  title: string;
  /** Loud right-side summary, e.g. «долг €135» / «8 · был 10 мая». */
  summary?: string;
  /** danger → red summary (долг). muted → grey regular (заметки/«—»). */
  tone?: "default" | "danger" | "muted";
  defaultOpen?: boolean;
  /** Block kind — set it to persist the open-state per kind (MMKV,
   *  `babun-block-open:{kind}`, web-parity). Omitted → session-only. */
  kind?: BlockKind;
  children: ReactNode;
}

export function CollapsibleCard({
  title,
  summary,
  tone = "default",
  defaultOpen = false,
  kind,
  children,
}: CollapsibleCardProps) {
  const t = useThemeColors();
  const [open, setOpen] = useState(() => readBlockOpen(kind, defaultOpen));
  const toggle = () => {
    const next = !open;
    writeBlockOpen(kind, next);
    setOpen(next);
  };

  const value = summary || "—";
  const valueColor =
    tone === "danger" ? t.danger : tone === "muted" || !summary ? t.sub : t.ink;
  const valueWeight = tone === "muted" || !summary ? "font-normal" : "font-semibold";
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <Card style={{ marginHorizontal: 12, marginTop: 8 }}>
      <Pressable
        onPress={toggle}
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
    </Card>
  );
}
