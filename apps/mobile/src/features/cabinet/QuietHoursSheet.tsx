import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { TimeRangePicker } from "@/components/ui/TimeWheel";
import { haptics } from "@/lib/haptics";
import { FOOTER_SIDE } from "@/components/ui/tokens";

// ТИХИЕ ЧАСЫ — пара «Начало · Конец» тем же барабаном, что у часов календаря
// (`TimeRangePicker`), но БЕЗ правила «конец позже начала»: тишина идёт через
// полночь (22:00–07:00), и `HourRangeSheet` её не выразил бы.

const toParts = (m: number) => ({ hour: Math.floor(m / 60), minute: m % 60 });

export function QuietHoursSheet({
  visible,
  start,
  end,
  onClose,
  onApply,
}: {
  visible: boolean;
  /** Минуты суток. */
  start: number;
  end: number;
  onClose: () => void;
  onApply: (start: number, end: number) => void;
}) {
  const [from, setFrom] = useState(toParts(start));
  const [to, setTo] = useState(toParts(end));
  // Черновик — по фронту открытия: перечитка настроек не перескакивает
  // барабан, который человек сейчас крутит.
  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current) {
      setFrom(toParts(start));
      setTo(toParts(end));
    }
    wasVisible.current = visible;
  }, [visible, start, end]);

  return (
    <BottomSheet
      padded={false}
      visible={visible}
      onClose={onClose}
      title="Тихие часы"
      footer={
        <View style={{ paddingHorizontal: FOOTER_SIDE }}>
          <Button
            label="Применить"
            onPress={() => {
              haptics.tap();
              onApply(from.hour * 60 + from.minute, to.hour * 60 + to.minute);
            }}
          />
        </View>
      }
    >
      <View className="px-5 pb-4">
        <TimeRangePicker
          start={from}
          end={to}
          onChangeStart={(patch) => setFrom((prev) => ({ ...prev, ...patch }))}
          onChangeEnd={(patch) => setTo((prev) => ({ ...prev, ...patch }))}
          allowEndOfDay={false}
        />
      </View>
    </BottomSheet>
  );
}
