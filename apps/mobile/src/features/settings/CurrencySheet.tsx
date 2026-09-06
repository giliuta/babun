import { useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { Search } from "lucide-react-native";
import {
  currencyWheelOrder,
  searchCurrencies,
  type CurrencyDef,
} from "@babun/shared/common/utils/currencies";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { ITEM_H, LoopWheelColumn } from "@/components/ui/TimeWheel";
import { GUTTER } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";

// ВАЛЮТА — ТОТ ЖЕ ЛИСТ, ЧТО ЧАСОВОЙ ПОЯС (владелец 2026-09-06: «сохраняем
// архитектуру: все валюты, сверху поиск, слева название, справа значок и
// код»). Барабан на семь строк, поиск вместо барабана пока ищут, строка
// одного ритма в обоих режимах: имя слева, символ и код справа по правому
// краю. Ходовые валюты — в голове барабана, остальные по алфавиту; свою
// находят поиском по имени, коду или символу.

const WHEEL_ROWS = 7;

function currencyRow({
  t,
  def,
  active,
}: {
  t: ReturnType<typeof useThemeColors>;
  def: CurrencyDef;
  active: boolean;
}) {
  return (
    <View
      className="flex-row items-center"
      style={{ width: "100%", paddingHorizontal: 14, gap: 10 }}
    >
      <Text
        maxFontSizeMultiplier={1.2}
        numberOfLines={1}
        style={{
          flex: 1,
          fontSize: active ? 17 : 15,
          fontWeight: active ? "600" : "400",
          letterSpacing: -0.2,
          color: active ? t.ink : t.placeholder,
        }}
      >
        {def.name}
      </Text>
      <Text
        maxFontSizeMultiplier={1.2}
        style={{
          fontSize: active ? 14 : 13,
          fontWeight: "500",
          color: active ? t.sub : t.faint,
          fontVariant: ["tabular-nums"],
        }}
      >
        {`${def.symbol} · ${def.code}`}
      </Text>
    </View>
  );
}

export function CurrencySheet({
  visible,
  onClose,
  value,
  onApply,
}: {
  visible: boolean;
  onClose: () => void;
  /** Текущий код валюты бизнеса. */
  value: string;
  onApply: (code: string) => void;
}) {
  const t = useThemeColors();
  const { width } = useWindowDimensions();
  const order = useMemo(() => currencyWheelOrder(), []);
  const indexOf = (code: string) =>
    Math.max(0, order.findIndex((c) => c.code === code.toUpperCase()));

  const [idx, setIdx] = useState(() => indexOf(value));
  const [query, setQuery] = useState("");

  // Лист живёт в дереве постоянно: без сброса открылся бы с прошлым выбором.
  useEffect(() => {
    if (!visible) return;
    setIdx(indexOf(value));
    setQuery("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только на открытии
  }, [visible, value]);

  const items = useMemo(() => order.map((c) => `${c.name}, ${c.symbol}, ${c.code}`), [order]);
  const hits = useMemo(() => searchCurrencies(query), [query]);
  const searching = query.trim().length > 0;
  const current = order[idx] ?? order[0];

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Валюта"
      maxHeightRatio={0.66}
      footer={
        <View className="px-5">
          <Button
            label="Применить"
            onPress={() => {
              onApply(current.code);
              onClose();
            }}
          />
        </View>
      }
    >
      <View style={{ paddingHorizontal: GUTTER }}>
        <View
          className="flex-row items-center"
          style={{
            paddingHorizontal: 12,
            minHeight: 44,
            gap: 8,
            borderRadius: t.radius.input,
            backgroundColor: t.canvas,
          }}
        >
          <Search color={t.faint} size={18} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Найти валюту"
            placeholderTextColor={t.placeholder}
            style={{ flex: 1, fontSize: 17, color: t.ink }}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>
      </View>

      {searching ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          style={{ maxHeight: ITEM_H * WHEEL_ROWS, marginTop: 10 }}
          contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: 8 }}
        >
          {hits.length === 0 ? (
            <View style={{ paddingVertical: 24, alignItems: "center" }}>
              <Text style={{ fontSize: 15, color: t.sub }}>Ничего не найдено</Text>
            </View>
          ) : (
            hits.map((def) => {
              const active = current.code === def.code;
              return (
                <Pressable
                  key={def.code}
                  onPress={() => {
                    setIdx(indexOf(def.code));
                    setQuery("");
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${def.name}, ${def.symbol}, ${def.code}`}
                  style={({ pressed }) => ({
                    height: ITEM_H,
                    justifyContent: "center",
                    borderRadius: t.radius.card,
                    backgroundColor: pressed ? t.pressed : active ? t.canvas : "transparent",
                  })}
                >
                  {currencyRow({ t, def, active: true })}
                </Pressable>
              );
            })
          )}
        </ScrollView>
      ) : (
        <View style={{ alignItems: "center", marginTop: 8 }}>
          <View style={{ height: ITEM_H * WHEEL_ROWS, marginBottom: 12, overflow: "hidden" }}>
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: ((WHEEL_ROWS - 1) / 2) * ITEM_H,
                height: ITEM_H,
                borderRadius: t.radius.card,
                backgroundColor: t.canvas,
              }}
            />
            <LoopWheelColumn
              items={items}
              value={idx}
              onChange={setIdx}
              accessibilityLabel="Валюта"
              width={Math.min(width - GUTTER * 2, 360)}
              rows={WHEEL_ROWS}
              renderItem={(_label, active, i) =>
                currencyRow({ t, def: order[i] ?? order[0], active })
              }
            />
          </View>
        </View>
      )}
    </BottomSheet>
  );
}
