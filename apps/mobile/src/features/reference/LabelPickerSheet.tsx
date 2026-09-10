import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Check, MapPin } from "lucide-react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { EmptyState } from "@/components/ui/EmptyState";
import { GUTTER } from "@/components/ui/tokens";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// ВЫБОР МЕТКИ — ОДИН ЛИСТ НА ВЕСЬ ПРОДУКТ (владелец 2026-09-10: «если я
// показываю в одном месте, значит то же самое будет показывать в другом
// месте, мне не надо разные дизайны»).
//
// До этого метку выбирали ТРИ разных листа, и каждый рисовал строку по-своему:
//   • метка записи и события (`appointments/LabelSheet`) — строка 52pt на
//     подложке, круглая плитка-пин в тинте, футер «Применить», который ничего
//     не применял: выбор уже применён тапом;
//   • метка дня (`calendar/DayLabelSheet`) — строка 48pt внутри одной карточки
//     с волосяными разделителями, КВАДРАТНАЯ плитка, залитая цветом целиком,
//     активная строка акцентом и полужирным, своя шапка 44│центр│44;
//   • метка клиента (`clients/LabelPickerSheet`) — вообще без плитки: точка
//     10pt, строка 44pt, рамка и тинт акцента на активной, кегль 14 вместо 15,
//     своя центрированная шапка и абзац-объяснение под списком (запрещённый
//     DESIGN-SYSTEM §«объяснялок под карточками нет вообще»).
// Три вида одного и того же списка меток из одной и той же таблицы.
//
// КАНОН СТРОКИ взят у выбора клиента, объекта и услуги: 52pt на подложке,
// круглая плитка 28pt, имя 15/600, галка у выбранной. Выбранная плитка залита
// цветом метки, невыбранные — той же краской в тинте: правило плиток типа
// события (владелец 2026-09-08).
//
// ТАП ВЫБИРАЕТ И ЗАКРЫВАЕТ — как во всех листах одиночного выбора продукта.
// Тап по УЖЕ выбранной снимает метку, если снимать разрешено (`onClear`): у
// дня и у клиента метки может не быть, у записи она есть всегда.

export interface LabelOption {
  name: string;
  color: string;
}

export function LabelPickerSheet({
  visible,
  title = "Метка",
  subtitle,
  options,
  value,
  onPick,
  onClear,
  onSettings,
  extra,
  onClose,
}: {
  visible: boolean;
  /** Чью метку правят: «Метка записи», «Метка события», «Метка клиента». */
  title?: string;
  /** Вторая строка шапки — например дата дня. */
  subtitle?: string;
  /** Метки команды — те же, что предлагаются дню. */
  options: readonly LabelOption[];
  /** Метка, действующая сейчас: своя либо взятая у дня. */
  value: string | null;
  onPick: (name: string) => void;
  /** Разрешено ли снять метку. Нет обработчика — тап по активной просто
   *  закрывает лист: у записи метка есть всегда и пустой быть не может. */
  onClear?: () => void;
  /** Шестерёнка в шапке — дверь в библиотеку меток. */
  onSettings?: ReactNode;
  /** Что показать ВЫШЕ списка: тумблер «Выходной» у метки дня. */
  extra?: ReactNode;
  onClose: () => void;
}) {
  const t = useThemeColors();

  const pick = (name: string) => {
    haptics.tap();
    if (name === value) {
      // Тап по активной снимает метку — там, где её можно не иметь.
      if (onClear) onClear();
    } else {
      onPick(name);
    }
    onClose();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      headerAction={onSettings}
      padded={false}
      scroll
      maxHeightRatio={0.7}
    >
      <View style={{ paddingHorizontal: GUTTER, paddingTop: 4, paddingBottom: 12, gap: 8 }}>
        {extra}
        {options.length > 0 ? (
          options.map((option) => {
            const chosen = option.name === value;
            return (
              <Pressable
                key={option.name}
                onPress={() => pick(option.name)}
                accessibilityRole="button"
                accessibilityState={{ selected: chosen }}
                accessibilityLabel={
                  chosen && onClear ? `${option.name} — снять метку` : option.name
                }
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
                    borderRadius: t.radius.pill,
                    alignItems: "center",
                    justifyContent: "center",
                    // Выбранная залита цветом метки, остальные — той же
                    // краской в тинте (правило плиток типа события).
                    backgroundColor: chosen ? option.color : `${option.color}26`,
                  }}
                >
                  <MapPin
                    color={chosen ? t.onAccent : option.color}
                    size={16}
                    strokeWidth={2.2}
                  />
                </View>
                <Text
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.3}
                  style={{ flex: 1, fontSize: 15, fontWeight: "600", color: t.ink }}
                >
                  {option.name}
                </Text>
                {chosen ? (
                  <Check color={t.accent} size={18} strokeWidth={2.4} />
                ) : null}
              </Pressable>
            );
          })
        ) : (
          <EmptyState title="У команды пока нет меток" />
        )}
      </View>
    </BottomSheet>
  );
}
