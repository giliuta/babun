import { Pressable } from "react-native";
import { Settings } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { BottomSheet, SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { SelectList, SelectRow } from "@/components/ui/select-rows";
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
  /** Значок строки: компонент из общего словаря (`icon-set`) либо эмодзи
   *  строкой — категории операций хранят именно его. */
  icon: LucideIcon | string;
  color: string;
  /** Тихая подпись под именем: «30 мин» у типа события. Не украшение —
   *  выбор типа МЕНЯЕТ длительность события, и сказать об этом надо до
   *  нажатия, а не после. */
  hint?: string;
  onPress: () => void;
}

export function PickerSheet({
  visible,
  title,
  items,
  selectedId,
  onSettings,
  settingsLabel = "Настроить список",
  onClose,
}: {
  visible: boolean;
  title: string;
  items: PickerSheetItem[];
  /** Что выбрано сейчас. У выбора «с нуля» (тип события новой записи) его
   *  нет; у правки существующей операции без него не видно, что стоит. */
  selectedId?: string | null;
  /** Шестерёнка справа от заголовка — вход на страницу этого списка. */
  onSettings?: () => void;
  settingsLabel?: string;
  onClose: () => void;
}) {
  const t = useThemeColors();
  return (
    <BottomSheet
      padded={false}
      visible={visible}
      onClose={onClose}
      // ШАПКА — ОБЩАЯ (2026-09-10). Здесь она была нарисована своей строкой с
      // ручным центрированием заголовка «на ширину шестерёнки»; `BottomSheet`
      // умеет это сам, и умеет одинаково для всех шторок продукта.
      title={title}
      headerAction={
        onSettings ? (
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
        ) : undefined
      }
    >
      {/* СТРОКА — ОБЩАЯ. Диалект тот же, что у выбора клиента, объекта и
          метки; галки нет по смыслу жанра: это ДЕЙСТВИЕ, а не значение. */}
      <SelectList>
        {items.map((item) => (
          <SelectRow
            key={item.id}
            icon={item.icon}
            color={item.color}
            title={item.label}
            hint={item.hint}
            selected={item.id === selectedId}
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
          />
        ))}
      </SelectList>
    </BottomSheet>
  );
}

export default PickerSheet;
