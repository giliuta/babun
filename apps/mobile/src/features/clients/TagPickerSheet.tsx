import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { Settings2, Tag } from "lucide-react-native";
import { iconPreset } from "@/components/ui/icon-set";
import type { ClientTag } from "@babun/shared/local/clients";
import { getAvatarColor } from "@babun/shared/common/utils/avatar-color";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  SELECT_SHEET_RATIO,
  SelectList,
  SelectRow,
} from "@/components/ui/select-rows";
import { GUTTER, ICON } from "@/components/ui/tokens";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// ПИКЕР ТЕГОВ — ТА ЖЕ ШТОРКА, ЧТО У МЕТКИ: одинаковая, на общих
// `select-rows`.
//
// ТЕГОВ У КЛИЕНТА НЕСКОЛЬКО (постоянный, компания…): шторка с «Применить»,
// можно отметить несколько, снять все или выбрать сразу три — как календари
// мастера (`CalendarPickerSheet`).
//
// ТАП ОТМЕЧАЕТ, «ПРИМЕНИТЬ» ПИШЕТ. Шторка держит черновик: отметки ничего не
// сохраняют, пока не нажато «Применить», и закрыть шторку жестом — значит
// передумать. Порядок набора — порядок тапов: первый отмеченный тег — главный,
// его плитка карточки показывает именем, остальные — «+N».

export function TagPickerSheet({
  visible,
  onSettings,
  tags,
  selected,
  onApply,
  onClose,
}: {
  visible: boolean;
  /** Каталог тегов тенанта (Кабинет → «Теги клиентов»). */
  tags: ClientTag[];
  /** Теги клиента сейчас, по порядку: первый — главный. */
  selected: string[];
  /** «Применить»: весь набор целиком, в порядке выбора. Пустой — снять все. */
  onApply: (ids: string[]) => void;
  /** Шестерёнка в шапке — страница справочника тегов (как у метки). */
  onSettings?: () => void;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const [draft, setDraft] = useState<string[]>(selected);
  // Каждое открытие начинается с того, что стоит у клиента сейчас: черновик
  // прошлого закрытия без «Применить» не должен всплыть.
  useEffect(() => {
    if (visible) setDraft(selected);
    // `selected` — свежий массив с каждым рендером карточки; сеять только на
    // открытии.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const toggle = (id: string) => {
    haptics.tap();
    setDraft((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  // СКРЫТОГО ТЕГА В ВЫБОРЕ НЕТ — кроме уже проставленного этому клиенту: иначе
  // прошлая карточка потеряет подпись, а человек решит, что тег удалили.
  // Закон общий для справочников (`swipe-edge-contract.test`).
  const shown = tags.filter(
    (tag) => !tag.hidden || selected.includes(tag.id) || draft.includes(tag.id),
  );
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Теги клиента"
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
      footer={
        shown.length > 0 ? (
          <View style={{ paddingHorizontal: GUTTER }}>
            <Button
              label="Применить"
              onPress={() => {
                onApply(draft);
                onClose();
              }}
            />
          </View>
        ) : undefined
      }
    >
      <SelectList>
        {shown.length > 0 ? (
          shown.map((tag) => (
            <SelectRow
              key={tag.id}
              // ЗНАЧОК ТЕГА — ЕГО СОБСТВЕННЫЙ: строка выбора обязана
              // показывать то же, что кабинет.
              icon={iconPreset(tag.icon) ?? Tag}
              title={tag.name}
              color={tag.color || getAvatarColor(tag.name)}
              selected={draft.includes(tag.id)}
              accessibilityRole="checkbox"
              onPress={() => toggle(tag.id)}
            />
          ))
        ) : (
          <EmptyState title="В каталоге пока нет тегов" />
        )}
      </SelectList>
    </BottomSheet>
  );
}
