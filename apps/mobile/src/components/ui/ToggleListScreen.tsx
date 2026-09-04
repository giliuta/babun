import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Check } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { ReorderList } from "@/components/ui/ReorderList";
import { GUTTER } from "@/components/ui/tokens";
import { RowCaption } from "@/components/ui/card-rows";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// СТРАНИЦА-НАБОР — «Способы связи», «Что можно добавить», «Карты для
// маршрута».
//
// ЗАКОН ВЛАДЕЛЬЦА 2026-08-02: НАСТРОЙКИ — ВСЕГДА ПОЛНОЦЕННАЯ СТРАНИЦА.
// Нижний лист остаётся для ДЕЙСТВИЯ на карточке («Добавить», «Как
// связаться»), а всё, что настраивают, открывается страницей.
//
// ПОРЯДОК ЗАДАЁТ ПОЛЬЗОВАТЕЛЬ (владелец 2026-08-02: «чтоб можно было менять
// их местами — перетаскивать; „Позвонить“ всегда первый»). Сам жест живёт в
// примитиве `ReorderList` — он один на продукт (им же собран «Порядок
// счетов»), здесь остаётся только строка-переключатель и правило «закреплённый
// пункт не двигается».

const ROW_H = 56;

export interface ToggleListItem {
  id: string;
  label: string;
  icon: LucideIcon;
  color: string;
  checked: boolean;
  /** Тап-переключатель игнорируется; подпись гаснет. Перетаскивание при этом
   *  остаётся: «последнюю карту нельзя выключить» — это не «нельзя двигать». */
  locked?: boolean;
  /** Закреплён сверху: не двигается вовсе («Позвонить»). */
  pinned?: boolean;
  /** Приписка, объясняющая замок: «всегда», «нужна хотя бы одна». */
  lockedNote?: string;
  onToggle: () => void;
}

/** Тело строки: значок · подпись · галка. Ручка перетаскивания живёт снаружи,
 *  в `ReorderList` — вложенная внутрь, она отдавала короткий тап строке, и
 *  палец «поправил порядок», а пункт молча выключался. */
function ToggleRow({ item }: { item: ToggleListItem }) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={() => {
        if (item.locked) return;
        haptics.tap();
        item.onToggle();
      }}
      disabled={item.locked}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: item.checked, disabled: !!item.locked }}
      accessibilityLabel={item.label}
      style={({ pressed }) => ({
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        height: ROW_H,
        paddingLeft: 16,
        paddingRight: 4,
        backgroundColor: pressed ? t.pressed : "transparent",
      })}
    >
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 999,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: `${item.color}1a`,
        }}
      >
        <item.icon color={item.color} size={16} strokeWidth={2.2} />
      </View>
      <Text
        maxFontSizeMultiplier={1.3}
        numberOfLines={1}
        style={{
          flex: 1,
          fontSize: 15,
          fontWeight: "600",
          color: item.locked ? t.faint : t.ink,
        }}
      >
        {item.label}
        {item.locked && item.lockedNote ? ` · ${item.lockedNote}` : ""}
      </Text>
      {item.checked ? (
        <Check color={t.accent} size={18} strokeWidth={2.6} />
      ) : null}
    </Pressable>
  );
}

export interface ToggleListSection {
  /** Капс-заголовок над карточкой. Одна секция — можно без него. */
  title?: string;
  items: ToggleListItem[];
  /** Тихая подпись под карточкой. */
  footer?: string;
  /** Новый порядок id. Не задан — секция не перетаскивается. */
  onReorder?: (ids: string[]) => void;
}

/** Секция со своим перетаскиванием: у каждого набора свой порядок. */
function Section({
  section,
  onDraggingChange,
}: {
  section: ToggleListSection;
  onDraggingChange: (dragging: boolean) => void;
}) {
  const { items, onReorder } = section;
  // Ниже закреплённых пунктов: «Позвонить» всегда первый, и встать выше него
  // нельзя ни одной строкой.
  const minIndex = items.findIndex((item) => !item.pinned);

  return (
    <>
      {section.title ? <SectionEyebrow>{section.title}</SectionEyebrow> : null}
      {/* КАЖДЫЙ ПУНКТ — СВОЯ КАРТОЧКА, А НЕ СТРОКА ОБЩЕГО ПОЛОТНА (владелец
          2026-09-04 про «Карты для маршрута»: «должно быть такой же
          архитектуры, как услуга или метка; разделитель должен быть не
          волосина, а нормальный разделитель, как и везде»). Тот же счёт он
          предъявил услугам 29 августа и меткам 30-го — теперь правило дошло и
          до страниц-наборов, последнего места со швами внутри карточки.
          Дело не только во вкусе: волосяной шов рвётся под пальцем. У строки,
          которую тянут, фон уезжает, у соседней остаётся — и линия повисает
          между ними ничьей. `spaced`-строка сама себе поверхность, и разделять
          их нечем: они и так раздельные. */}
      <View style={{ marginHorizontal: GUTTER, marginTop: 8 }}>
        <ReorderList
          items={items}
          rowHeight={ROW_H}
          spaced
          labelFor={(item) => item.label}
          rangeFor={(index) =>
            onReorder && !items[index].pinned
              ? [minIndex, items.length - 1]
              : [index, index]
          }
          onReorder={(ids) => onReorder?.(ids)}
          onDraggingChange={onDraggingChange}
        >
          {(item) => <ToggleRow item={item} />}
        </ReorderList>
      </View>
      {section.footer ? <RowCaption text={section.footer} /> : null}
    </>
  );
}

export function ToggleListScreen({
  title,
  hint,
  sections,
}: {
  title: string;
  /** Подпись под заголовком: зачем этот набор. */
  hint?: string;
  sections: ToggleListSection[];
}) {
  // Пока строку тянут, список не должен уезжать под пальцем.
  const [dragging, setDragging] = useState(false);
  const anyDraggable = sections.some((s) => !!s.onReorder);

  return (
    <Screen>
      <ScreenHeader title={title} subtitle={hint} />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        scrollEnabled={!dragging}
      >
        {sections.map((section, i) => (
          <Section
            key={section.title ?? `section-${i}`}
            section={section}
            onDraggingChange={setDragging}
          />
        ))}
        {anyDraggable ? (
          <RowCaption text="Порядок задаёте вы: тяните строку за ручку справа." />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

export default ToggleListScreen;
