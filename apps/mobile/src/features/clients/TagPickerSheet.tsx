import { View } from "react-native";
import { Tag } from "lucide-react-native";
import { iconPreset } from "@/components/ui/icon-set";
import type { ClientTag } from "@babun/shared/local/clients";
import { getAvatarColor } from "@babun/shared/common/utils/avatar-color";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { GUTTER } from "@/components/ui/tokens";
import {
  SELECT_SHEET_RATIO,
  SelectList,
  SelectRow,
} from "@/components/ui/select-rows";
import { haptics } from "@/lib/haptics";

// ПИКЕР ТЕГОВ — ТА ЖЕ ШТОРКА, ЧТО У МЕТКИ (владелец 2026-07-26: «теги должны
// быть на уровне „Личное“ как метки… сделай одинаковое как метки»).
//
// Так и было записано в этом файле — и не было сделано: строка стояла 44pt
// вместо 52, вместо кружка сущности — точка 10pt, выбранное обводилось рамкой,
// заголовок рисовался своим `<Text>` в теле, кнопка «Готово» была плоской
// заливкой руками, а пустое состояние — абзацем с объяснением, которого канон
// не допускает вовсе. Сведено 2026-09-10 на общие `select-rows`.
//
// Отличие от метки одно и оно смысловое: метка у клиента ОДНА (тап выбирает и
// закрывает), тегов может быть несколько — поэтому шторка остаётся открытой, а
// закрывает её «Применить», как и выбор услуг.

export function TagPickerSheet({
  visible,
  tags,
  selected,
  onToggle,
  onClose,
}: {
  visible: boolean;
  /** Каталог тегов тенанта (Кабинет → «Теги клиентов»). */
  tags: ClientTag[];
  selected: string[];
  onToggle: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Теги"
      padded={false}
      scroll
      maxHeightRatio={SELECT_SHEET_RATIO}
      footer={
        <View style={{ paddingHorizontal: GUTTER }}>
          <Button label="Применить" onPress={onClose} />
        </View>
      }
    >
      <SelectList>
        {tags.length > 0 ? (
          tags.map((tag) => (
            <SelectRow
              key={tag.id}
              // ЗНАЧОК ТЕГА — ЕГО СОБСТВЕННЫЙ. Ярлычок на всех строках был
              // честен, пока значка у тега не было (2026-09-10 появился):
              // теперь строка выбора обязана показывать то же, что кабинет.
              icon={iconPreset(tag.icon) ?? Tag}
              title={tag.name}
              color={tag.color || getAvatarColor(tag.name)}
              selected={selected.includes(tag.id)}
              accessibilityRole="checkbox"
              onPress={() => {
                haptics.tap();
                onToggle(tag.id);
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
