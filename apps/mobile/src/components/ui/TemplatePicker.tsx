import { useState } from "react";
import { Keyboard, Pressable, Text, View } from "react-native";
import { CopyPlus, X } from "lucide-react-native";
import { AppearanceTile } from "@/components/ui/AppearanceSheet";
import { FieldLabel } from "@/components/ui/Field";
import { GUTTER } from "@/components/ui/tokens";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// ШАБЛОНЫ ИЗ ДРУГИХ КОМАНД — ОДИН ВИД НА ВСЕ СПРАВОЧНИКИ (владелец 11.10:
// «помнишь, как мы сделали с услугами — сделай это со всеми: категории,
// метки и так далее»). В шторке «Новая …» справа в шапке значок; тап — в той
// же шторке вместо формы список того, что уже заведено в других командах
// аккаунта; тап по строке заполняет форму, и её правят дальше. Второго окна
// нет: окно поверх шторки iOS не показывает (так «залагало» у услуг).

export interface TemplateItem<T> {
  key: string;
  name: string;
  color?: string | null;
  icon?: string | null;
  /** Чей шаблон — подпись строки (команда). */
  sub?: string;
  /** Справа в строке: цена, вид. */
  trailing?: string;
  value: T;
}

/** Состояние «показан список шаблонов» одной шторки. */
export function useTemplatePicking() {
  const [picking, setPicking] = useState(false);
  return { picking, setPicking };
}

/** Значок шаблонов для `headerAction` шторки; при открытом списке — крестик. */
export function TemplatesHeaderButton({
  picking,
  onToggle,
}: {
  picking: boolean;
  onToggle: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        Keyboard.dismiss();
        onToggle();
      }}
      accessibilityRole="button"
      accessibilityLabel={picking ? "Закрыть шаблоны" : "Шаблоны из других команд"}
      hitSlop={10}
      style={({ pressed }) => ({
        width: 32,
        height: 32,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.5 : 1,
      })}
    >
      {picking ? (
        <X color={t.sub} size={22} strokeWidth={2} />
      ) : (
        <CopyPlus color={t.accent} size={22} strokeWidth={2} />
      )}
    </Pressable>
  );
}

/** Список шаблонов вместо формы — в той же шторке. */
export function TemplateList<T>({
  items,
  title = "Из других команд",
  onPick,
  gutter = true,
}: {
  items: readonly TemplateItem<T>[];
  title?: string;
  onPick: (value: T) => void;
  /** Шторка без своего отступа (`padded={false}`) — отступ ставит список. */
  gutter?: boolean;
}) {
  const t = useThemeColors();
  return (
    <View style={{ paddingHorizontal: gutter ? GUTTER : 0, paddingBottom: 16, gap: 8 }}>
      <FieldLabel text={title} />
      {items.map((item) => (
        <Pressable
          key={item.key}
          onPress={() => {
            haptics.tap();
            onPick(item.value);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Шаблон ${item.name}`}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            minHeight: 60,
            paddingHorizontal: 14,
            borderRadius: t.radius.card,
            borderCurve: "continuous",
            backgroundColor: pressed ? t.pressed : t.surface,
            borderWidth: 1,
            borderColor: t.separator,
          })}
        >
          {item.color !== undefined || item.icon !== undefined ? (
            <AppearanceTile color={item.color ?? null} icon={item.icon ?? null} size={34} />
          ) : null}
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ fontSize: 15, fontWeight: "600", color: t.ink }}>
              {item.name}
            </Text>
            {item.sub ? (
              <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: t.sub, marginTop: 1 }}>
                {item.sub}
              </Text>
            ) : null}
          </View>
          {item.trailing ? (
            <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 15, fontWeight: "600", color: t.ink }}>
              {item.trailing}
            </Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

/** Шаблоны справочника из других команд: заведённые здесь по имени — нет. */
export function otherTeamTemplates<R>(
  rows: readonly R[],
  opts: {
    teamId: string | null | undefined;
    teamOf: (row: R) => string | null | undefined;
    nameOf: (row: R) => string;
    active?: (row: R) => boolean;
  },
): R[] {
  if (!opts.teamId) return [];
  const here = new Set(
    rows
      .filter((row) => opts.teamOf(row) === opts.teamId)
      .map((row) => opts.nameOf(row).trim().toLowerCase()),
  );
  const seen = new Set<string>();
  return rows.filter((row) => {
    const team = opts.teamOf(row);
    if (!team || team === opts.teamId) return false;
    if (opts.active && !opts.active(row)) return false;
    const name = opts.nameOf(row).trim().toLowerCase();
    if (!name || here.has(name) || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}
