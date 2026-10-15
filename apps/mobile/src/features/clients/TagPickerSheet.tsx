import { Pressable } from "react-native";
import { Settings2, Tag } from "lucide-react-native";
import { iconPreset } from "@/components/ui/icon-set";
import type { ClientTag } from "@babun/shared/local/clients";
import { getAvatarColor } from "@babun/shared/common/utils/avatar-color";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  SELECT_SHEET_RATIO,
  SelectList,
  SelectRow,
} from "@/components/ui/select-rows";
import { ICON } from "@/components/ui/tokens";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// ПИКЕР ТЕГОВ — ТА ЖЕ ШТОРКА, ЧТО У МЕТКИ: одинаковая, на общих
// `select-rows`. Свои вариации не годятся: строка 44pt вместо 52, точка 10pt
// вместо кружка сущности, рамка у выбранного, заголовок своим `<Text>` в
// теле, «Готово» плоской заливкой руками, пустое состояние абзацем с
// объяснением — канон всего этого не допускает.
//
// ТЕГ У КЛИЕНТА ОДИН — КАК МЕТКА, без кнопки «Применить». Тап выбирает и
// закрывает; тап по выбранному снимает его. Кнопка «Применить», как у выбора
// услуг, нужна только при нескольких значениях.

export function TagPickerSheet({
  visible,
  onSettings,
  tags,
  selected,
  onPick,
  onClose,
}: {
  visible: boolean;
  /** Каталог тегов тенанта (Кабинет → «Теги клиентов»). */
  tags: ClientTag[];
  selected: string[];
  /** Тап по тегу: выбрать его вместо прежнего или снять, если он выбран. */
  onPick: (id: string) => void;
  /** Шестерёнка в шапке — страница справочника тегов (как у метки). */
  onSettings?: () => void;
  onClose: () => void;
}) {
  const t = useThemeColors();
  // СКРЫТОГО ТЕГА В ВЫБОРЕ НЕТ — кроме уже проставленного этому клиенту: иначе
  // прошлая карточка потеряет подпись, а человек решит, что тег удалили.
  // Закон общий для справочников (`swipe-edge-contract.test`).
  const shown = tags.filter((tag) => !tag.hidden || selected.includes(tag.id));
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Тег клиента"
      headerAction={
        onSettings ? (
          <Pressable
            onPress={onSettings}
            accessibilityRole="button"
            accessibilityLabel="Настроить теги"
            className="h-11 w-11 items-center justify-center active:opacity-60"
          >
            <Settings2 color={t.sub} size={ICON.sm} strokeWidth={2} />
          </Pressable>
        ) : undefined
      }
      padded={false}
      scroll
      maxHeightRatio={SELECT_SHEET_RATIO}
    >
      <SelectList>
        {shown.length > 0 ? (
          shown.map((tag) => (
            <SelectRow
              key={tag.id}
              // ЗНАЧОК ТЕГА — ЕГО СОБСТВЕННЫЙ. Ярлычок на всех строках был
              // честен, пока значка у тега не было: раз он есть, строка
              // выбора обязана показывать то же, что кабинет.
              icon={iconPreset(tag.icon) ?? Tag}
              title={tag.name}
              color={tag.color || getAvatarColor(tag.name)}
              selected={selected.includes(tag.id)}
              onPress={() => {
                haptics.tap();
                onPick(tag.id);
                onClose();
              }}
            />
          ))
        ) : (
          <EmptyState title="В каталоге пока нет тегов" />
        )}
      </SelectList>
    </BottomSheet>
  );
}
