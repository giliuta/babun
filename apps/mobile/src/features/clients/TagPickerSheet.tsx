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
import { FOOTER_SIDE, ICON } from "@/components/ui/tokens";
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
  open,
  onSettings,
  tags,
  selected,
  onApply,
  onClose,
  title = "Теги клиента",
  markMain = true,
}: {
  /** Заголовок: у пачки клиентов — что делаем («Поставить теги»). */
  title?: string;
  /** Подпись «Главный» у первого отмеченного. Снятию тегов порядок не
   *  важен — подпись соврала бы. */
  markMain?: boolean;
  visible: boolean;
  /** Шторка открыта по смыслу. Шестерёнка паркует её (`visible` ложно), но
   *  не закрывает: отметки до похода в настройки должны дожить до возврата.
   *  Нет — открытие совпадает с `visible`. */
  open?: boolean;
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
  // прошлого закрытия без «Применить» не должен всплыть. Возврат с парковки —
  // не открытие: сеять на нём значит стереть сделанные отметки.
  const opened = open ?? visible;
  useEffect(() => {
    if (opened) setDraft(selected);
    // `selected` — свежий массив с каждым рендером карточки; сеять только на
    // открытии.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

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
      title={title}
      headerAction={
        onSettings ? (
          <Pressable
            onPress={onSettings}
            accessibilityRole="button"
            accessibilityLabel="Настроить теги"
            className="h-11 w-11 items-center justify-center active:opacity-60"
          >
            <Settings2 color={t.sub} size={ICON.command} strokeWidth={2} />
          </Pressable>
        ) : undefined
      }
      padded={false}
      scroll
      maxHeightRatio={SELECT_SHEET_RATIO}
      footer={
        shown.length > 0 ? (
          <View style={{ paddingHorizontal: FOOTER_SIDE }}>
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
              // ГЛАВНЫЙ — ПЕРВЫЙ ОТМЕЧЕННЫЙ: его покажет плитка тега на карточке
              // и строка списка. Без подписи правило угадывалось только по
              // плитке после «Применить».
              subtitle={markMain && draft[0] === tag.id && draft.length > 1 ? "Главный" : undefined}
              accessibilityRole="checkbox"
              onPress={() => toggle(tag.id)}
            />
          ))
        ) : (
          <EmptyState title="Тегов пока нет" />
        )}
      </SelectList>
    </BottomSheet>
  );
}
