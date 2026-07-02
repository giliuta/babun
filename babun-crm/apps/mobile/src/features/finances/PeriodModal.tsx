import { useEffect, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Check } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { formatYMD, parseYMD } from "@/features/appointments/helpers";
import {
  makePeriod,
  PRESET_LABELS,
  PRESET_ORDER,
  type Period,
  type PeriodPreset,
} from "./period";

export function PeriodModal({
  visible,
  current,
  onClose,
  onApply,
}: {
  visible: boolean;
  current: Period;
  onClose: () => void;
  onApply: (p: Period) => void;
}) {
  const t = useThemeColors();
  const [from, setFrom] = useState(current.from);
  const [to, setTo] = useState(current.to);

  // The modal stays mounted — resync the wheels with the active period on
  // every open, otherwise they keep showing the range from first mount.
  useEffect(() => {
    if (!visible) return;
    setFrom(current.from);
    setTo(current.to);
  }, [visible, current.from, current.to]);

  const pickPreset = (preset: PeriodPreset) => {
    onApply(makePeriod(preset));
    onClose();
  };

  const applyCustom = () => {
    // An inverted range would silently query an empty window — swap it.
    const [f, t2] = from <= to ? [from, to] : [to, from];
    onApply({ preset: "custom", from: f, to: t2 });
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: t.scrim }}>
        <Pressable className="flex-1" onPress={onClose} />
        <View className="rounded-t-3xl p-5 pb-8" style={{ backgroundColor: t.surface }}>
          <Text className="mb-3 text-lg font-bold" style={{ color: t.ink }}>Период</Text>

          {PRESET_ORDER.map((preset) => {
            const active = current.preset === preset;
            return (
              <Pressable
                key={preset}
                onPress={() => pickPreset(preset)}
                className="flex-row items-center justify-between py-3 active:opacity-70"
                style={{ borderBottomWidth: 1, borderBottomColor: t.separator }}
              >
                <Text className="text-base" style={{ color: t.ink }}>
                  {PRESET_LABELS[preset]}
                </Text>
                {active ? <Check color={t.accent} size={ICON.md} /> : null}
              </Pressable>
            );
          })}

          {/* custom range */}
          <View className="mt-4 rounded-2xl p-3" style={{ backgroundColor: t.canvas }}>
            <Text className="mb-1 text-xs font-semibold uppercase tracking-wider" style={{ color: t.sub }}>
              Свой период
            </Text>
            <View className="flex-row items-center justify-between py-1.5">
              <Text className="text-base" style={{ color: t.ink }}>С</Text>
              <DateTimePicker
                value={parseYMD(from)}
                mode="date"
                display="compact"
                onChange={(_, d) => d && setFrom(formatYMD(d))}
              />
            </View>
            <View className="flex-row items-center justify-between py-1.5">
              <Text className="text-base" style={{ color: t.ink }}>По</Text>
              <DateTimePicker
                value={parseYMD(to)}
                mode="date"
                display="compact"
                onChange={(_, d) => d && setTo(formatYMD(d))}
              />
            </View>
            <View className="mt-2">
              <Button label="Применить период" onPress={applyCustom} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
