import type { ReactNode } from "react";
import { Bookmark } from "lucide-react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  SELECT_SHEET_RATIO,
  SelectList,
  SelectRow,
} from "@/components/ui/select-rows";
import { haptics } from "@/lib/haptics";

// ВЫБОР МЕТКИ — ОДИН ЛИСТ НА ВЕСЬ ПРОДУКТ: метка записи, события, дня и
// клиента выбирается одним и тем же видом, без разных дизайнов одного списка
// из одной таблицы.
//
// КАНОН СТРОКИ взят у выбора клиента, объекта и услуги: 52pt на подложке,
// круглая плитка 28pt, имя 15/600, галка у выбранной. Выбранная плитка залита
// цветом метки, невыбранные — той же краской в тинте: правило плиток типа
// события.
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
      maxHeightRatio={SELECT_SHEET_RATIO}
    >
      <SelectList>
        {extra}
        {options.length > 0 ? (
          options.map((option) => {
            const chosen = option.name === value;
            return (
              <SelectRow
                key={option.name}
                icon={Bookmark}
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
