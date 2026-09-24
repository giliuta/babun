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

// ПИКЕР ТЕГОВ — ТА ЖЕ ШТОРКА, ЧТО У МЕТКИ (владелец 2026-07-26: «теги должны
// быть на уровне „Личное“ как метки… сделай одинаковое как метки»).
//
// Так и было записано в этом файле — и не было сделано: строка стояла 44pt
// вместо 52, вместо кружка сущности — точка 10pt, выбранное обводилось рамкой,
// заголовок рисовался своим `<Text>` в теле, кнопка «Готово» была плоской
// заливкой руками, а пустое состояние — абзацем с объяснением, которого канон
// не допускает вовсе. Сведено 2026-09-10 на общие `select-rows`.
//
// ТЕГ У КЛИЕНТА ОДИН — КАК МЕТКА (владелец 22.09: «в тегах убери кнопку
// „Применить“: идёт выбор тега, и выбирается один, то же самое, как одна
// метка»). Тап выбирает и закрывает; тап по выбранному снимает его. Раньше
// тегов было несколько, и шторку закрывало «Применить», как выбор услуг.

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
              // честен, пока значка у тега не было (2026-09-10 появился):
              // теперь строка выбора обязана показывать то же, что кабинет.
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
