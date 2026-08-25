import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, ChevronDown } from "lucide-react-native";
import { useThemeColors } from "@/theme/colors";

export type CalMode = "day" | "week" | "month" | "agenda";

// День / Неделя / Месяц / Список («3 дня» удалён по решению владельца
// 2026-07-13 — промежуточный режим не использовался).
const MODES: { key: CalMode; label: string }[] = [
  { key: "day", label: "День" },
  { key: "week", label: "Неделя" },
  { key: "month", label: "Месяц" },
  { key: "agenda", label: "Список" },
];
const LABEL: Record<CalMode, string> = {
  day: "День",
  week: "Неделя",
  month: "Месяц",
  agenda: "Список",
};

// Web-parity view switcher: a single labeled pill that opens a dropdown menu
// (NOT a segmented control). Current mode is accent + Check.
export function ViewModeDropdown({
  mode,
  onChange,
}: {
  mode: CalMode;
  onChange: (m: CalMode) => void;
}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`Режим просмотра: ${LABEL[mode]}`}
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => ({
          height: 36,
          paddingHorizontal: 12,
          borderRadius: t.radius.card,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          backgroundColor: pressed ? t.pressed : "transparent",
        })}
      >
        <Text style={{ fontSize: 15, fontWeight: "600", color: t.ink }}>
          {LABEL[mode]}
        </Text>
        <ChevronDown color={t.faint} size={16} strokeWidth={2.5} />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        {/* accessible={false}: Pressable-подложка иначе группирует меню в
            один безымянный «button» для VoiceOver — пункты недостижимы. */}
        <Pressable
          accessible={false}
          style={{ flex: 1 }}
          onPress={() => setOpen(false)}
        >
          <View
            // Жест-escape VoiceOver: иначе из меню не выйти, не сменив режим.
            onAccessibilityEscape={() => setOpen(false)}
            style={{
              position: "absolute",
              // Below the 48-pt header row, respecting the status-bar inset
              // (Dynamic Island vs old notch) instead of a fixed 100.
              top: insets.top + 52,
              right: 12,
              minWidth: 180,
              backgroundColor: t.surface,
              // 14 — единый радиус поповеров шапки (MiniCalendar такой же).
              borderRadius: t.radius.card,
              borderWidth: 1,
              borderColor: t.separator,
              paddingVertical: 4,
              boxShadow: t.cardShadow,
            }}
          >
            {MODES.map((m) => {
              const cur = m.key === mode;
              return (
                <Pressable
                  key={m.key}
                  onPress={() => {
                    onChange(m.key);
                    setOpen(false);
                  }}
                  accessibilityRole="menuitem"
                  accessibilityLabel={m.label}
                  accessibilityState={{ selected: cur }}
                  style={({ pressed }) => ({
                    minHeight: 44,
                    paddingHorizontal: 12,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    backgroundColor: pressed ? t.pressed : "transparent",
                  })}
                >
                  <Text
                    style={{
                      fontSize: 15,
                      fontWeight: cur ? "600" : "400",
                      color: cur ? t.accent : t.ink,
                    }}
                  >
                    {m.label}
                  </Text>
                  {cur ? (
                    <Check color={t.accent} size={16} strokeWidth={2.5} />
                  ) : (
                    <View style={{ width: 16 }} />
                  )}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
