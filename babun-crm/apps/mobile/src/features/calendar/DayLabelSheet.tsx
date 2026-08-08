import { useRef } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Check, MapPin, Settings } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { haptics } from "@/lib/haptics";
import { parseYMD } from "@/features/appointments/helpers";
import { useThemeColors } from "@/theme/colors";

// Метка дня (web parity CityPickerModal, Sprint 029) — нижний лист (закон
// «создание — листом», канон BottomSheet). Открывается тапом по числу ВСЕГДА:
// шапка — «Метка» + дата + шестерёнка настроек меток; список — тонированная
// плитка-пин, имя, галочка на активной; тап по активной строке снимает метку
// (web v501 — отдельного «Снять метку» нет, v693). Пустой список — честное
// состояние с прямой дорогой «Добавить метки».

export interface CityOption {
  name: string;
  color: string;
}

export function DayLabelSheet({
  visible,
  dateKey,
  options,
  selected,
  onPick,
  onClear,
  onClose,
  onSettings,
}: {
  visible: boolean;
  /** YYYY-MM-DD дня, чью метку меняем — подзаголовок шапки. */
  dateKey: string;
  options: CityOption[];
  /** Текущая метка дня (имя) или "". */
  selected: string;
  onPick: (name: string) => void;
  onClear: () => void;
  onClose: () => void;
  /** Шестерёнка в шапке — настройки меток активной команды. */
  onSettings?: () => void;
}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();

  // Заморозка на время анимации закрытия: родитель обнуляет дату сразу, а
  // лист уезжает ещё 240 мс — без заморозки подзаголовок прыгал на сегодня
  // и только что поставленная галочка гасла прямо на глазах.
  const lastShown = useRef({ dateKey, selected });
  if (visible) lastShown.current = { dateKey, selected };
  const shown = visible ? { dateKey, selected } : lastShown.current;

  const dateLabel = (() => {
    const s = parseYMD(shown.dateKey).toLocaleDateString("ru-RU", {
      weekday: "short",
      day: "numeric",
      month: "long",
    });
    return s.charAt(0).toUpperCase() + s.slice(1);
  })();

  const handlePick = (name: string) => {
    haptics.tap();
    // Тап по активной метке = снять её (web v501: «не могу отменить выбор»).
    if (name === shown.selected) onClear();
    else onPick(name);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View
        className="px-5 pt-1"
        // Канон нижнего отступа листов (ClientsFilterSheet): home-индикатор
        // не срезает последнюю строку, без него — честные 24.
        style={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
      >
        <View className="flex-row items-center">
          <View className="flex-1" style={{ minWidth: 0 }}>
            <Text
              accessibilityRole="header"
              maxFontSizeMultiplier={1.2}
              className="text-[17px] font-semibold"
              style={{ color: t.ink }}
            >
              Метка
            </Text>
            <Text className="mt-0.5 text-[13px]" style={{ color: t.sub }}>
              {dateLabel}
            </Text>
          </View>
          {onSettings ? (
            <Pressable
              onPress={onSettings}
              accessibilityRole="button"
              accessibilityLabel="Настройки меток"
              className="h-11 w-11 items-center justify-center rounded-full active:opacity-60"
            >
              <Settings color={t.sub} size={20} strokeWidth={2} />
            </Pressable>
          ) : null}
        </View>

        {options.length === 0 ? (
          <View className="mt-3">
            <Text className="mb-3 text-[13px]" style={{ color: t.faint }}>
              У команды пока нет меток. Метка — это город или смена дня:
              она красит дату и колонку, чтобы маршрут читался с одного
              взгляда.
            </Text>
            {onSettings ? (
              <Button
                label="Добавить метки"
                variant="secondary"
                onPress={onSettings}
              />
            ) : null}
          </View>
        ) : (
          <View
            className="mt-3 overflow-hidden"
            style={{ backgroundColor: t.canvas, borderRadius: t.radius.card }}
          >
            <ScrollView style={{ maxHeight: 380 }} bounces={false}>
              {options.map((o, i) => {
                const active = o.name === shown.selected;
                return (
                  <View key={o.name}>
                    {i > 0 ? (
                      // 56 = 16 + 28 + 12: разделитель в линию с текстом
                      // после плитки-пина (iOS inset separator).
                      <View
                        style={{ height: 1, marginLeft: 56, backgroundColor: t.separator }}
                      />
                    ) : null}
                    <Pressable
                      onPress={() => handlePick(o.name)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={
                        active ? `${o.name} — снять метку` : o.name
                      }
                      className="flex-row items-center gap-3 px-4 py-3 active:opacity-60"
                      style={{ minHeight: 48 }}
                    >
                      <View
                        className="items-center justify-center"
                        style={{
                          height: 28,
                          width: 28,
                          borderRadius: 8,
                          backgroundColor: o.color,
                        }}
                      >
                        <MapPin color={t.onAccent} size={16} strokeWidth={2.2} />
                      </View>
                      {/* Активная строка — акцент+semibold: единая грамматика
                          одиночного выбора (эталон PeriodPresetModal). */}
                      <Text
                        className="flex-1"
                        style={{
                          fontSize: 15,
                          fontWeight: active ? "600" : "500",
                          color: active ? t.accent : t.ink,
                        }}
                      >
                        {o.name}
                      </Text>
                      {active ? (
                        <Check color={t.accent} size={18} strokeWidth={2.5} />
                      ) : null}
                    </Pressable>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        )}
      </View>
    </BottomSheet>
  );
}
