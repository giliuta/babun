import type { ReactNode } from "react";
import { MapPin } from "lucide-react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { EmptyState } from "@/components/ui/EmptyState";
import { SelectList, SelectRow } from "@/components/ui/select-rows";
import { haptics } from "@/lib/haptics";

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
      <SelectList>
        {extra}
        {options.length > 0 ? (
          options.map((option) => {
            const chosen = option.name === value;
            return (
              <SelectRow
                key={option.name}
                icon={MapPin}
                title={option.name}
                color={option.color}
                selected={chosen}
                accessibilityLabel={
                  chosen && onClear ? `${option.name} — снять метку` : option.name
                }
                onPress={() => pick(option.name)}
              />
            );
          })
        ) : (
          <EmptyState title="У команды пока нет меток" />
        )}
      </SelectList>
    </BottomSheet>
  );
}
