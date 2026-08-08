import { Pressable, Text, View } from "react-native";
import { Settings } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { BottomSheet, SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// ЛИСТ ВЫБОРА ДЕЙСТВИЯ — «Добавить» на карточке, «Как связаться» у номера
// (владелец 2026-08-02: «запомни этот вид дизайна и используй везде»).
// Строка = цветной значок слева + подпись; тап выбирает и закрывает лист.
//
// ЛИСТ — ЭТО ДЕЙСТВИЕ, А НЕ НАСТРОЙКА. Наборы («Способы связи», «Что можно
// добавить», «Карты для маршрута») живут ПОЛНОЦЕННЫМИ СТРАНИЦАМИ
// (ToggleListScreen) — закон владельца 2026-08-02. Шестерёнка в углу
// заголовка ведёт на страницу своего списка, а не открывает второй лист
// поверх первого.
//
// Язык строки на странице и в листе один и тот же: человек узнаёт список,
// откуда бы он ни пришёл.

export interface PickerSheetItem {
  id: string;
  label: string;
  icon: LucideIcon;
  color: string;
  onPress: () => void;
}

export function PickerSheet({
  visible,
  title,
  items,
  onSettings,
  settingsLabel = "Настроить список",
  onClose,
}: {
  visible: boolean;
  title: string;
  items: PickerSheetItem[];
  /** Шестерёнка справа от заголовка — вход на страницу этого списка. */
  onSettings?: () => void;
  settingsLabel?: string;
  onClose: () => void;
}) {
  const t = useThemeColors();
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: 20,
          paddingRight: 12,
          paddingTop: 8,
          paddingBottom: 12,
        }}
      >
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={1.2}
          numberOfLines={1}
          style={{
            flex: 1,
            fontSize: 17,
            fontWeight: "600",
            color: t.ink,
            // Заголовок центрируется относительно ЛИСТА, а не остатка строки:
            // шестерёнка справа иначе сдвигала бы его влево.
            marginLeft: onSettings ? 32 : 0,
            textAlign: "center",
          }}
        >
          {title}
        </Text>
        {onSettings ? (
          <Pressable
            onPress={() => {
              haptics.tap();
              onClose();
              onSettings();
            }}
            accessibilityRole="button"
            accessibilityLabel={settingsLabel}
            hitSlop={10}
            style={({ pressed }) => ({
              width: 32,
              height: 32,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.5 : 1,
            })}
          >
            <Settings color={t.sub} size={20} strokeWidth={2} />
          </Pressable>
        ) : null}
      </View>

      <View style={{ paddingHorizontal: 20, paddingBottom: 28, gap: 8 }}>
        {items.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => {
              haptics.tap();
              onClose();
              // ДЕЙСТВИЕ ЖДЁТ, ПОКА ЛИСТ УЕДЕТ. BottomSheet закрывается 240 мс,
              // и всё, что открывает своё окно поверх (второй лист, Alert,
              // системный «Поделиться»), в тот же кадр просто не появлялось:
              // «Напомнить» из меню не открывало ничего. Держим правило в
              // примитиве — иначе каждый экран заводит свой setTimeout и
              // забывает его там, где лист второй раз не нужен.
              setTimeout(item.onPress, SHEET_EXIT_MS);
            }}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              minHeight: 52,
              paddingHorizontal: 14,
              borderRadius: t.radius.input,
              backgroundColor: pressed ? t.rowFillPressed : t.rowFill,
            })}
          >
            <View
              style={{
                width: 28,
                height: 28,
                borderRadius: 999,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: `${item.color}1a`,
              }}
            >
              <item.icon color={item.color} size={16} strokeWidth={2.2} />
            </View>
            <Text
              maxFontSizeMultiplier={1.3}
              numberOfLines={1}
              style={{ flex: 1, fontSize: 15, fontWeight: "600", color: t.ink }}
            >
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </BottomSheet>
  );
}

export default PickerSheet;
