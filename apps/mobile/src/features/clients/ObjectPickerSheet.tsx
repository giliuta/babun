import { useMemo, useRef } from "react";
import { Pressable, Text, View } from "react-native";
import { Check, MapPin } from "lucide-react-native";
import type { Location } from "@babun/shared/local/clients";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { objectTarget } from "@/features/clients/object-address";
import { useThemeColors } from "@/theme/colors";

// ВЫБОР ОБЪЕКТА ДЛЯ ЗАПИСИ — лист, как выбор клиента (владелец 2026-09-03:
// «мы тапаем на клиента — открывается выбор клиента; то же самое объект:
// тапаем на объект — идёт замена объекта, и внизу вылазит „Добавить
// объект“»).
//
// Диалект — `ClientPickerSheet`: строка 52pt на подложке, кружок 28pt слева,
// галка у выбранного, тап выбирает и закрывает. Поиска нет: объектов у
// клиента два-три, и список виден целиком. Основной — первым, как на
// карточке: порядок и есть признак основного.
//
// «ДОБАВИТЬ ОБЪЕКТ» — ЕДИНСТВЕННАЯ КНОПКА ЛИСТА, в `footer`: то самое
// действие, ради которого сюда идут, когда нужного объекта нет. Открывает
// канонический лист добавления (`ObjectSheet`) — но только когда окно этого
// листа СНЯТО (`onExited`): два листа в один кадр на iOS не показываются.
//
// Хаптика выбора живёт у получателя (`pickLocation`), здесь её нет — иначе
// один тап отдавал два тика.

const ICON_CIRCLE = 28;
/** Боковое поле строк и кнопки — одно на лист (закон одного хозяина
 *  отступа): лист `padded={false}`, и футер сам полей не платит. */
const SIDE = 20;

export function ObjectPickerSheet({
  visible,
  locations,
  selectedId,
  onSelect,
  onAdd,
  onClose,
}: {
  visible: boolean;
  locations: readonly Location[];
  selectedId: string | null;
  onSelect: (location: Location) => void;
  /** Открыть лист добавления объекта — после того, как этот уедет. */
  onAdd: () => void;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const afterExit = useRef<(() => void) | null>(null);
  const ordered = useMemo(
    () =>
      [...locations].sort(
        (a, b) => Number(!!b.isPrimary) - Number(!!a.isPrimary),
      ),
    [locations],
  );
  return (
    <BottomSheet
      padded={false}
      visible={visible}
      onClose={onClose}
      title="Объект"
      maxHeightRatio={0.5}
      scroll
      onExited={() => {
        const run = afterExit.current;
        afterExit.current = null;
        run?.();
      }}
      footer={
        <View style={{ paddingHorizontal: SIDE }}>
          <Button
            label="Добавить объект"
            onPress={() => {
              afterExit.current = onAdd;
              onClose();
            }}
            accessibilityHint="Открывает добавление объекта"
          />
        </View>
      }
    >
      <View style={{ paddingHorizontal: SIDE, paddingTop: 4, paddingBottom: 12, gap: 8 }}>
        {ordered.map((loc) => {
          const label = loc.label || "Объект";
          const target = objectTarget(loc);
          const chosen = loc.id === selectedId;
          return (
            <Pressable
              key={loc.id}
              onPress={() => {
                onSelect(loc);
                onClose();
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: chosen }}
              accessibilityLabel={[label, target].filter(Boolean).join(", ")}
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
                  width: ICON_CIRCLE,
                  height: ICON_CIRCLE,
                  borderRadius: t.radius.pill,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: `${t.accent}1a`,
                }}
              >
                <MapPin color={t.accent} size={16} strokeWidth={2.2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.3}
                  style={{ fontSize: 15, fontWeight: "600", color: t.ink }}
                >
                  {label}
                </Text>
                <Text
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.3}
                  style={{ fontSize: 13, color: target ? t.sub : t.faint }}
                >
                  {target || "адрес не указан"}
                </Text>
              </View>
              {chosen ? (
                <Check color={t.accent} size={18} strokeWidth={2.4} />
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </BottomSheet>
  );
}
