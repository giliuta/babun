import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Check } from "lucide-react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { ICON } from "@/components/ui/tokens";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import { hourLabel } from "@/features/calendar/setting-options";
import { isAutoWindow } from "@/features/calendar/window";

// Пара часов «С … До …» одним нижним листом — диалект «Своего периода»
// финансов (PeriodWheelsModal): сегмент С|До выбирает границу, ниже она
// правится, «Применить» коммитит. Владелец 2026-08-16: «часы календаря —
// снизу, как время в финансах: с такого-то до такого-то».
//
// Вместо колеса — родной список строк с галкой (OptionSheet-диалект):
// нативный спиннер не умеет «только часы», а колесо с минутами пришлось бы
// тихо округлять — список из 24 строк честнее и тапается быстрее. Выбор «С»
// сам перекидывает сегмент на «До»: вся пара ставится в два тапа.
//
// autoOption добавляет тумблер «Автоматически» (Часы календаря: окно
// выводится из рабочих часов и записей; пара 0–24 — его кодовое значение).

export function HourRangeSheet({
  visible,
  title,
  value,
  autoOption,
  onClose,
  onApply,
}: {
  visible: boolean;
  title: string;
  /** Текущая пара; при autoOption пара 0–24 читается как «Автоматически». */
  value: { start: number; end: number };
  /** Тумблер «Автоматически» и его пояснение (только у «Часов календаря»). */
  autoOption?: { hint: string };
  onClose: () => void;
  onApply: (v: { start: number; end: number } | "auto") => void;
}) {
  const t = useThemeColors();
  const [auto, setAuto] = useState(false);
  const [start, setStart] = useState(8);
  const [end, setEnd] = useState(20);
  const [side, setSide] = useState<"start" | "end">("start");
  const listRef = useRef<ScrollView>(null);

  // Ресинк черновика — по фронту открытия (приём PeriodWheelsModal): рефетч
  // настроек не должен перескакивать пару, которую человек сейчас ставит.
  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current) {
      const isAuto = !!autoOption && isAutoWindow(value);
      setAuto(isAuto);
      // Авто хранится парой 0–24 — черновику она не годится: выключив
      // тумблер, человек должен увидеть осмысленную пару, а не 00–24.
      setStart(isAuto ? 8 : value.start);
      setEnd(isAuto ? 20 : value.end);
      setSide("start");
    }
    wasVisible.current = visible;
  }, [visible, value, autoOption]);

  // Список прокручивается к активному значению своей стороны: 24 строки не
  // влезают, и без этого выбранный час каждый раз пришлось бы искать.
  const ROW = 44;
  const active = side === "start" ? start : end;
  useEffect(() => {
    if (!visible || auto) return;
    // Через кадр: на фронте открытия ScrollView ещё не разложен (лист
    // выезжает), и немедленный scrollTo уходит в пустоту.
    const raf = requestAnimationFrame(() => {
      listRef.current?.scrollTo({
        y: Math.max(0, active * ROW - 88),
        animated: false,
      });
    });
    return () => cancelAnimationFrame(raf);
    // Прокрутка — при смене стороны/открытии; сам выбор строку не двигает.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, auto, side]);

  const pick = (h: number) => {
    haptics.tap();
    if (side === "start") {
      setStart(h);
      // Конец обязан быть позже начала — двигаем его минимально, как везде.
      if (end <= h) setEnd(h + 1);
      setSide("end");
    } else {
      setEnd(h);
    }
  };

  const apply = () => {
    haptics.tap();
    onApply(auto ? "auto" : { start, end });
    onClose();
  };

  const segment = (key: "start" | "end", label: string, v: number) => {
    const activeSeg = side === key;
    return (
      <Pressable
        key={key}
        accessibilityRole="radio"
        accessibilityState={{ selected: activeSeg }}
        accessibilityLabel={`${label}: ${hourLabel(v)}`}
        onPress={() => {
          haptics.tap();
          setSide(key);
        }}
        className="flex-1 items-center justify-center"
        style={{
          minHeight: 48,
          paddingVertical: 4,
          borderRadius: t.radius.card - 4,
          backgroundColor: activeSeg ? t.surface : "transparent",
        }}
      >
        <Text
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: activeSeg ? t.accent : t.faint }}
        >
          {label}
        </Text>
        <Text
          className="text-[15px] font-semibold"
          style={{ color: t.ink, fontVariant: ["tabular-nums"] }}
        >
          {hourLabel(v)}
        </Text>
      </Pressable>
    );
  };

  // Начало — до 23:00 (часу нужен конец после него); конец — строго позже
  // выбранного начала, вплоть до 24:00.
  const hours =
    side === "start"
      ? Array.from({ length: 24 }, (_, h) => h)
      : Array.from({ length: 24 - start }, (_, i) => start + 1 + i);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={title}
      footer={
        <View className="px-5">
          <Button label="Применить" onPress={apply} />
        </View>
      }
    >
      <View className="px-5 pb-2">
        {autoOption ? (
          <View
            className="mb-3 overflow-hidden"
            style={{ backgroundColor: t.canvas, borderRadius: t.radius.card }}
          >
            <SwitchRow
              label="Автоматически"
              hint={autoOption.hint}
              value={auto}
              onChange={(v) => {
                haptics.tap();
                setAuto(v);
              }}
            />
          </View>
        ) : null}

        {!auto ? (
          <>
            <View
              className="mb-3 flex-row p-1"
              style={{
                backgroundColor: t.fill,
                gap: 4,
                borderRadius: t.radius.card,
              }}
            >
              {segment("start", "С", start)}
              {segment("end", "До", end)}
            </View>

            <View
              className="overflow-hidden"
              style={{ backgroundColor: t.canvas, borderRadius: t.radius.card }}
            >
              <ScrollView ref={listRef} style={{ maxHeight: 264 }}>
                {hours.map((h, i) => {
                  const selected = h === active;
                  return (
                    <View key={h}>
                      {i > 0 ? (
                        <View
                          style={{
                            height: 1,
                            marginLeft: 16,
                            backgroundColor: t.separator,
                          }}
                        />
                      ) : null}
                      <Pressable
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        accessibilityLabel={hourLabel(h)}
                        onPress={() => pick(h)}
                        style={({ pressed }) => ({
                          minHeight: ROW,
                          flexDirection: "row",
                          alignItems: "center",
                          paddingHorizontal: 16,
                          backgroundColor: pressed
                            ? t.rowFillPressed
                            : "transparent",
                        })}
                      >
                        <Text
                          className="text-[15px]"
                          style={{
                            flex: 1,
                            color: selected ? t.accent : t.ink,
                            fontWeight: selected ? "600" : "400",
                            fontVariant: ["tabular-nums"],
                          }}
                        >
                          {hourLabel(h)}
                        </Text>
                        {selected ? (
                          <Check color={t.accent} size={ICON.sm} strokeWidth={3} />
                        ) : null}
                      </Pressable>
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          </>
        ) : null}
      </View>
    </BottomSheet>
  );
}
