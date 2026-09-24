import { View } from "react-native";
import { UserPlus } from "lucide-react-native";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { SectionCard } from "@/components/ui/SectionCard";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { LinkRow, suppressRoleCommit } from "@/features/clients/LinkRow";
import { useThemeColors } from "@/theme/colors";

// БЛОК СВЯЗЕЙ КЛИЕНТА (STORY-085, вариант 3 владельца 2026-09-21).
//
// Люди карточки живут строками в ПЕРВОМ блоке, рядом с номерами
// (`ClientLinkRows`; владелец 2026-09-21: «первый блок — клиент, туда входят
// люди, связи, компании… всё в один блок»). Своей карточкой с шапкой блок
// стоит только в листе объекта — «Жильцы».
//
// Каждая строка — ДРУГОЙ клиент со своей карточкой (`LinkRow`). Свайп только
// убирает связь: карточка человека остаётся в клиентах, поэтому слово на
// кромке — «Убрать», а не «Удалить».

export interface ClientLinkItem {
  /** Ключ строки — связь, а не клиент: один человек может стоять в блоке
   *  дважды (жилец двух вилл одной управляющей). */
  key: string;
  name: string;
  /** Объект жильца — «Вилла 5». */
  place?: string;
  phone?: string | null;
  telegramUsername?: string | null;
  role: string;
}

/** Строки связей БЕЗ своей карточки — для первого блока карточки клиента,
 *  где люди стоят рядом с номерами (владелец 2026-09-21: «первый блок —
 *  клиент, туда входят люди, связи, компании»). Каждая строка отделена
 *  волоском сверху: над ними всегда стоит строка блока — дверь контактов
 *  «Добавить». */
export function ClientLinkRows({
  items,
  rolePlaceholder,
  focusKey,
  separatedFirst = true,
  compact = false,
  onOpen,
  onRoleChange,
  onRemove,
}: {
  items: readonly ClientLinkItem[];
  rolePlaceholder?: string;
  focusKey?: string | null;
  /** Волосок над первой строкой: в блоке клиента над ней номер, в своей
   *  карточке — шапка, и там он не нужен. */
  separatedFirst?: boolean;
  /** ОДНОЙ СТРОКОЙ — «Илья · Villa 5 · жилец». С 22.09 так и на странице
   *  клиента, и в листе («Жильцы»): владелец по макету — люди строкой той же
   *  высоты, что номер, без аватара (сторож — `client-page-contract.test.ts`).
   *  Высокая ветка осталась для мест, где строка стоит одна в своей карточке. */
  compact?: boolean;
  onOpen: (item: ClientLinkItem) => void;
  onRoleChange?: (item: ClientLinkItem, role: string) => void;
  onRemove?: (item: ClientLinkItem) => void;
}) {
  const t = useThemeColors();
  return (
    <>
      {items.map((item, i) => {
        const row = (
          <LinkRow
            compact={compact}
            linkKey={item.key}
            name={item.name}
            place={item.place}
            phone={item.phone}
            telegramUsername={item.telegramUsername}
            role={item.role}
            rolePlaceholder={rolePlaceholder}
            separated={i > 0 || separatedFirst}
            autoFocusRole={item.key === focusKey}
            onOpen={() => onOpen(item)}
            onRoleChange={
              onRoleChange ? (role) => onRoleChange(item, role) : undefined
            }
          />
        );
        return onRemove ? (
          <SwipeRow
            key={item.key}
            label="Убрать"
            color={t.danger}
            // СВАЙП УБИРАЕТ СРАЗУ, БЕЗ ВОПРОСА (владелец 22.09: «убрать связь
            // можно свайпом вправо „Удалить“, как у нас объекты, и в целом
            // всё можно вот так вот убирать»). Терять нечего: карточка
            // человека остаётся в клиентах, а вернуть связь — «Отменить» в
            // подсказке (страница, `removeLink` в ClientPeopleDoor).
            // Отдельная причина: у жильцов свайп живёт ВНУТРИ шторки объекта,
            // а подтверждение — нижний лист, и он рисовался бы под ней.
            onAction={() => {
              // ПЕРЕД удалением: строка сейчас размонтируется, и её
              // отложенный коммит роли записал бы связь обратно.
              suppressRoleCommit(item.key);
              onRemove(item);
            }}
            accessibilityLabel={`Убрать ${item.name}`}
          >
            {row}
          </SwipeRow>
        ) : (
          <View key={item.key}>{row}</View>
        );
      })}
    </>
  );
}

export function ClientLinksBlock({
  title,
  items,
  rolePlaceholder,
  focusKey,
  addLabel,
  dense,
  compact = dense,
  onAdd,
  onOpen,
  onRoleChange,
  onRemove,
}: {
  title: string;
  items: readonly ClientLinkItem[];
  rolePlaceholder?: string;
  /** Строка, которую только что добавили: курсор сразу в её роль. */
  focusKey?: string | null;
  /** Дверь добавления внизу блока. Нет `onAdd` — двери нет. */
  addLabel?: string;
  /** Блок в листе (объект): тише воздух, как у соседних блоков листа. */
  dense?: boolean;
  /** Строки в одну строку. По умолчанию — как воздух блока: единственный
   *  плотный блок продукта это «Жильцы» в листе объекта, и держать два слова
   *  про одно и то же значило бы завести их расхождение. Развести можно —
   *  проп отдельный. */
  compact?: boolean;
  onAdd?: () => void;
  onOpen: (item: ClientLinkItem) => void;
  /** Нет — роли только читаются. */
  onRoleChange?: (item: ClientLinkItem, role: string) => void;
  /** Нет — связь не убрать (нет права менять контакты). */
  onRemove?: (item: ClientLinkItem) => void;
}) {
  // Пустой блок без двери ни о чём не говорит — его просто нет.
  if (items.length === 0 && !onAdd) return null;

  return (
    <SectionCard title={title} dense={dense}>
      <ClientLinkRows
        items={items}
        rolePlaceholder={rolePlaceholder}
        focusKey={focusKey}
        separatedFirst={false}
        compact={compact}
        onOpen={onOpen}
        onRoleChange={onRoleChange}
        onRemove={onRemove}
      />
      {onAdd ? (
        <ChooseRow
          icon={UserPlus}
          label={addLabel ?? "Добавить"}
          compact={compact}
          onPress={onAdd}
        />
      ) : null}
    </SectionCard>
  );
}
