import { Pressable, ScrollView, Text, View } from "react-native";
import { Circle, Settings2, type LucideIcon } from "lucide-react-native";
import { BottomSheet, SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { haptics } from "@/lib/haptics";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  SELECT_SHEET_RATIO,
  SelectList,
  SelectRow,
} from "@/components/ui/select-rows";
import { useThemeColors } from "@/theme/colors";
import { ICON } from "./tokens";

// ВЫБОР ОДНОГО ЗНАЧЕНИЯ ИЗ ДЛИННОГО СПИСКА.
//
// Третий случай выбора, которого не покрывали первые два примитива:
//   PickerSheet — «что сделать» (5-6 крупных плиток, без галочки);
//   ToggleListScreen — страница-набор, где галочек много.
// А тут значений бывает двадцать (категории расходов), выбирается ровно одно,
// и у списка есть СВОЯ страница, где эти значения заводят. Центральной
// карточки для такого выбора нет: всё приезжает снизу одним движением.
//
// Шестерёнка ведёт на страницу списка: рука уже здесь, в момент, когда нужной
// строки не нашлось. Это единственный вход в настройку изнутри выбора.
//
// САМ СПИСОК — ОТДЕЛЬНЫЙ ЭКСПОРТ (`ValueOptionList`). Выбор бывает не только
// собственным листом: внутри денежного листа он приезжает ВТОРЫМ ШАГОМ того же
// листа (лист поверх листа стоил бы закрытия первого и потери набранного).
// Обе роли обязаны выглядеть одинаково, поэтому вёрстка строки живёт в одном
// месте, а лист — это она же плюс шапка.

interface ValueOption {
  id: string;
  label: string;
  /** Вторая строка — чем этот вариант отличается. */
  hint?: string;
  /** Число СПРАВА — то, ради чего вариант и выбирают (остаток счёта).
   *  Моноширинное: суммы стоят колонкой и не гуляют между рендерами. */
  value?: string;
  /** Вариант ГАСНЕТ, но остаётся на месте: исчезнувшая строка читается как
   *  «счёт пропал», а погашенная — как «сюда нельзя, и вот почему»
   *  (объяснение живёт в `footer`). */
  disabled?: boolean;
  /** Точка-метка слева: цвет категории/счёта. Без цвета точки нет. */
  color?: string | null;
  /** ЗНАЧОК СУЩНОСТИ вместо безымянной точки. Счёт узнают по значку и цвету
   *  в списке, в панели и в карточке — а в шаге «Откуда/Куда» он
   *  терялся бы, превратившись в строку текста. Без значка строка
   *  с цветом по-прежнему рисует кружок. */
  icon?: LucideIcon;
}

/** Список вариантов одной карточкой. Правило под ней объясняет погашенное. */
export function ValueOptionList({
  options,
  selectedId,
  emptyLabel = "Список пуст",
  footer,
  clearable = true,
  onPick,
}: {
  options: readonly ValueOption[];
  selectedId?: string | null;
  emptyLabel?: string;
  /** Правило под списком — объясняет погашенные варианты. */
  footer?: string;
  /** Повторный тап по выбранному СНИМАЕТ выбор. Выключается там, где «ничего
   *  не выбрано» — не значение, а тупик: человек открывает список, чтобы
   *  убедиться в выборе, тапает по нему же и остаётся ни с чем. */
  clearable?: boolean;
  onPick: (id: string | null) => void;
}) {
  const t = useThemeColors();
  return (
    // СТРОКА — ОБЩАЯ. Своя строка (высота 48, точка 10pt вместо кружка
    // сущности, подпись 16/400 и значение 15/600 — то есть ЗНАЧЕНИЕ ГРОМЧЕ
    // ПОДПИСИ, вопреки закону одиночного выбора — внутри склеенной карточки с
    // волосяными разделителями) показывала бы один и тот же вопрос «выбери
    // одно» двумя способами: выбор клиента, объекта, услуги и метки рисует
    // строки на подложке с зазором.
    <View>
      <SelectList>
        {options.length === 0 ? (
          <EmptyState title={emptyLabel} />
        ) : (
          options.map((o) => (
            <SelectRow
            key={o.id}
            title={o.label}
            subtitle={o.hint}
            color={o.color ?? undefined}
            icon={o.icon ?? (o.color ? Circle : undefined)}
            value={o.value}
            disabled={o.disabled}
            selected={o.id === selectedId}
            accessibilityRole="radio"
            accessibilityLabel={[o.label, o.hint, o.value].filter(Boolean).join(", ")}
            onPress={() => {
              haptics.tap();
              onPick(o.id === selectedId && clearable ? null : o.id);
            }}
          />
          ))
        )}
      </SelectList>
      {footer ? (
        <Text
          maxFontSizeMultiplier={1.3}
          style={{
            marginTop: 8,
            marginHorizontal: 4,
            fontSize: 13,
            lineHeight: 18,
            color: t.faint,
          }}
        >
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

export function ValuePickerSheet({
  visible,
  title,
  options,
  selectedId,
  emptyLabel,
  footer,
  onPick,
  onSettings,
  settingsLabel = "Настроить список",
  onClose,
}: {
  visible: boolean;
  title: string;
  options: readonly ValueOption[];
  selectedId?: string | null;
  emptyLabel?: string;
  footer?: string;
  onPick: (id: string | null) => void;
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
      maxHeightRatio={SELECT_SHEET_RATIO}
      // ШАПКА — ОБЩАЯ: `BottomSheet` центрирует заголовок «на ширину
      // шестерёнки» сам и одинаково для всех шторок продукта.
      title={title}
      headerAction={
        onSettings ? (
          <Pressable
            onPress={() => {
              haptics.tap();
              onClose();
              // Уход на страницу ждёт, пока лист уедет: навигация в тот же
              // кадр оставляла экран под наполовину уползшим листом.
              setTimeout(onSettings, SHEET_EXIT_MS);
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
            <Settings2 color={t.sub} size={ICON.command} strokeWidth={2} />
          </Pressable>
        ) : undefined
      }
    >
      <ScrollView
        style={{ flexShrink: 1 }}
        contentContainerStyle={{ paddingBottom: 20 }}
      >
        <ValueOptionList
          options={options}
          selectedId={selectedId}
          emptyLabel={emptyLabel}
          footer={footer}
          onPick={(id) => {
            onPick(id);
            onClose();
          }}
        />
      </ScrollView>
    </BottomSheet>
  );
}

export default ValuePickerSheet;
