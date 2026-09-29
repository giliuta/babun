import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { Check, Eye, EyeOff, Lock, PencilLine, type LucideIcon } from "lucide-react-native";

import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";

// РАМКА ВИДА БЛОКА — кусок страницы на её же фоне, чтобы блок в шторке
// выглядел так, как стоит на экране сотрудника. Нажать в нём ничего нельзя:
// это картинка, а не форма.
//
// Над блоком — одна строка о том, что с ним у человека. Закрытый блок не
// пропадает, а бледнеет: пустота ничего бы не объяснила, а плашка поверх
// блока его закрывала. Строка стоит и над открытым блоком: «Видит» и
// «Меняет» на картинке выглядят одинаково (дверь выбора — это нажатие, а не
// рисунок), и без подписи ступени казались бы одной и той же.

export type PreviewState = "hidden" | "cannot" | "read" | "write" | "can";

const LOOK: Record<PreviewState, { word: string; icon: LucideIcon }> = {
  hidden: { word: "Этого блока у него нет", icon: EyeOff },
  cannot: { word: "Этого он не может", icon: Lock },
  read: { word: "Видит, но не меняет", icon: Eye },
  write: { word: "Видит и меняет", icon: PencilLine },
  can: { word: "Это он может", icon: Check },
};

/** Положение права → состояние вида: `off` (и `hidden` правила записи) —
 *  блока нет; `write` — меняет; остальное (`read`, `own`, `all`) — видит. */
export function levelState(level: string | undefined): PreviewState {
  if (level === undefined || level === "off" || level === "hidden") return "hidden";
  return level === "write" ? "write" : "read";
}

export function PreviewFrame({
  state,
  caption,
  captionOff = false,
  children,
}: {
  state: PreviewState;
  /** Своя подпись вместо общей — когда общая сказала бы неправду
   *  («Цены: Не видит» — услуги на месте, пропали только деньги). */
  caption?: string;
  /** Своя подпись говорит о закрытом («Номеров не видит») — значок
   *  перечёркнутого глаза, хотя сам блок на месте. */
  captionOff?: boolean;
  children: ReactNode;
}) {
  const t = useThemeColors();
  const closed = state === "hidden" || state === "cannot";
  const look = LOOK[state];
  const Icon = captionOff ? EyeOff : look.icon;
  const tone = state === "write" || state === "can" ? t.accent : t.sub;
  const word = caption ?? look.word;
  return (
    <View
      pointerEvents="none"
      accessible
      accessibilityLabel={`${word}. Так это выглядит у него`}
      style={{ backgroundColor: t.canvas, paddingTop: 2, paddingBottom: 12, marginBottom: 4 }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginHorizontal: 16, marginTop: 8 }}>
        <Icon color={tone} size={ICON.xs} strokeWidth={2.2} />
        <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 13, fontWeight: "600", color: tone }}>
          {word}
        </Text>
      </View>
      <View style={{ opacity: closed ? 0.4 : 1 }}>{children}</View>
    </View>
  );
}
