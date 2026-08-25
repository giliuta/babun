import { Pressable, ScrollView, Text, View } from "react-native";
import { Check, Settings } from "lucide-react-native";
import { BottomSheet, SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// ВЫБОР ОДНОГО ЗНАЧЕНИЯ ИЗ ДЛИННОГО СПИСКА.
//
// Третий случай выбора, которого не покрывали первые два примитива:
//   PickerSheet — «что сделать» (5-6 крупных плиток, без галочки, не скроллится);
//   ToggleListScreen — страница-набор, где галочек много.
// А тут значений бывает двадцать (категории расходов), выбирается ровно одно,
// и у списка есть СВОЯ страница, где эти значения заводят. Раньше такое
// рисовали центральной карточкой (OptionSheet) — против закона «всё приезжает
// снизу одним движением».
//
// Шестерёнка ведёт на страницу списка: рука уже здесь, в момент, когда нужной
// строки не нашлось. Это единственный вход в настройку изнутри выбора.
//
// САМ СПИСОК — ОТДЕЛЬНЫЙ ЭКСПОРТ (`ValueOptionList`). Выбор бывает не только
// собственным листом: внутри денежного листа он приезжает ВТОРЫМ ШАГОМ того же
// листа (лист поверх листа стоил бы закрытия первого и потери набранного).
// Обе роли обязаны выглядеть одинаково, поэтому вёрстка строки живёт в одном
// месте, а лист — это она же плюс шапка.

export interface ValueOption {
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
    <View>
      <View
        style={{
          borderRadius: t.radius.card,
          overflow: "hidden",
          backgroundColor: t.surface,
        }}
      >
        {options.length === 0 ? (
          <Text
            maxFontSizeMultiplier={1.3}
            style={{
              paddingHorizontal: 16,
              paddingVertical: 18,
              fontSize: 15,
              color: t.faint,
              textAlign: "center",
            }}
          >
            {emptyLabel}
          </Text>
        ) : (
          options.map((o, i) => {
            const active = o.id === selectedId;
            return (
              <View key={o.id}>
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
                  onPress={() => {
                    haptics.tap();
                    onPick(active && clearable ? null : o.id);
                  }}
                  disabled={o.disabled}
                  accessibilityRole="radio"
                  accessibilityState={{
                    selected: active,
                    disabled: !!o.disabled,
                  }}
                  accessibilityLabel={[o.label, o.hint, o.value]
                    .filter(Boolean)
                    .join(", ")}
                  style={({ pressed }) => ({
                    minHeight: 48,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                    opacity: o.disabled ? 0.4 : 1,
                    backgroundColor: pressed ? t.pressed : "transparent",
                  })}
                >
                  {o.color ? (
                    <View
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 999,
                        backgroundColor: o.color,
                      }}
                    />
                  ) : null}
                  <View style={{ flex: 1 }}>
                    <Text
                      maxFontSizeMultiplier={1.3}
                      numberOfLines={1}
                      style={{ fontSize: 16, color: t.ink }}
                    >
                      {o.label}
                    </Text>
                    {o.hint ? (
                      <Text
                        maxFontSizeMultiplier={1.3}
                        numberOfLines={1}
                        style={{ fontSize: 13, color: t.faint, marginTop: 1 }}
                      >
                        {o.hint}
                      </Text>
                    ) : null}
                  </View>
                  {o.value ? (
                    <Text
                      maxFontSizeMultiplier={1.3}
                      numberOfLines={1}
                      style={{
                        flexShrink: 0,
                        fontSize: 15,
                        fontWeight: "600",
                        color: t.ink,
                        // ТОЛЬКО СТИЛЕМ: `tabular-nums` в className в этом
                        // стеке — пустышка (src/lib/nativewind-traps.test.ts).
                        fontVariant: ["tabular-nums"],
                      }}
                    >
                      {o.value}
                    </Text>
                  ) : null}
                  {active ? (
                    <Check color={t.accent} size={18} strokeWidth={2.5} />
                  ) : null}
                </Pressable>
              </View>
            );
          })
        )}
      </View>
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
    <BottomSheet padded={false} visible={visible} onClose={onClose} maxHeightRatio={0.8}>
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
            <Settings color={t.sub} size={20} strokeWidth={2} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        style={{ flexShrink: 1 }}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 28 }}
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
