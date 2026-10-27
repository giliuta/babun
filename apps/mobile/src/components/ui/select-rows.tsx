import type { ReactNode } from "react";
import { Image, Pressable, Text, TextInput, View } from "react-native";
import { Check, Search, X } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { GUTTER, ICON } from "@/components/ui/tokens";
import { PICKER_RADIUS } from "@/components/ui/picker-grid";
import { readableTextOnColor } from "@/components/ui/color-contrast";
import { useThemeColors } from "@/theme/colors";

// АНАТОМИЯ ШТОРКИ ВЫБОРА — ОДНА НА ВЕСЬ ПРОДУКТ. Где бы ни просили «выбрать
// клиента» — в календаре, финансах, клиентах, — снизу поднимается шторка одной
// и той же архитектуры: ни одно место не вправе рисовать её по-своему.
//
// Канон был записан — комментарием внутри `BookingPickers`: «заголовок в жесте
// грабера → поиск → список строк 52pt на подложке → одна кнопка в футере вне
// прокрутки; строка: кружок 28pt слева, имя 15/600, подпись 13, отметка
// справа». Следовали ему две шторки из семи, потому что следовать было нечему:
// код лежал копиями. Что выросло на месте канона:
//
//   выбор клиента в записи — 52pt, кружок с буквой, свой `SearchField`;
//   выбор клиента в инвойсе и «кто привёл» — 52pt, но заголовок нарисован
//     своим `<Text>` в теле, поиск — свой второй `TextInput` на 40pt,
//     пустое состояние — голая строка текста;
//   выбор объекта — 52pt, но боковой отступ 20 вместо 16;
//   выбор тега — строка 44pt (`h-11`), рамка вместо галки, заголовка нет;
//   выбор значения (категория, счёт) — строка 48pt, и значение НАБРАНО
//     ГРОМЧЕ подписи, вопреки закону одиночного выбора;
//   выбор метки — 52pt.
//
// Три высоты строки, три поля поиска, три способа нарисовать заголовок. Отсюда
// два примитива ниже: `SelectSearch` и `SelectRow`. Оправу даёт `BottomSheet`
// (`title`, `subtitle`, `headerAction`, `footer`), пустое состояние —
// `EmptyState`. Слово на кнопке — из реестра в AGENTS.md.

/** ПОТОЛОК ШТОРКИ ВЫБОРА — ПОЛЭКРАНА. Шторка выбора открывается не на всю
 *  страницу, а примерно наполовину, и внутри уже листают: под невысокой
 *  шторкой видно форму, из которой пришли, а до верхних строк не надо
 *  тянуться. Половина выбрана глазами в сравнении с 75% на симуляторе. Число
 *  одно на все шторки: разнесённое по ним вручную (0.5, 0.7, 0.8 или вовсе
 *  без потолка у `PickerSheet`), оно расходилось.
 *
 *  Потолок работает ТОЛЬКО вместе с `scroll` у `BottomSheet`: без прокрутки
 *  лист молча обрезает хвост списка. Так и было у категории расхода — 15 строк
 *  в справочнике, 12 на экране, последние три недостижимы ничем. */
export const SELECT_SHEET_RATIO = 0.5;

/** Поиск в шторке выбора. Нужен там, где строк больше десятка: у клиента их
 *  сотни, у объектов клиента две-три — и тогда поля нет вовсе. */
export function SelectSearch({
  value,
  onChange,
  placeholder,
  accessibilityLabel,
  onClear,
  autoCapitalize,
  autoFocus,
  bare,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  accessibilityLabel: string;
  onClear?: () => void;
  autoCapitalize?: "none" | "words";
  /** КУРСОР СРАЗУ В ПОИСКЕ. Не всем шторкам: у выбора счёта или категории
   *  строк десяток, и поднятая клавиатура закрыла бы половину списка. Нужен
   *  там, где шторку открыла дверь с готовым вопросом («Кто живёт в Вилле
   *  5»): справочник на сотни имён, и первое движение там — набрать имя, а
   *  не искать глазами. */
  autoFocus?: boolean;
  /** Поле в чужой полосе (шапка списка): без отступов шторки. Поиск в
   *  продукте один — и в шторке, и в шапке «Клиентов». */
  bare?: boolean;
}) {
  const t = useThemeColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        // В чужой полосе ширину даёт родитель; `flex: 1` тянул бы поле и по
        // высоте — до 48 полосы вместо 40 поиска.
        ...(bare ? null : { marginHorizontal: GUTTER, marginBottom: 10 }),
        paddingLeft: 12,
        paddingRight: value ? 4 : 12,
        minHeight: 40,
        borderRadius: t.radius.input,
        backgroundColor: t.fill,
      }}
    >
      <Search color={t.faint} size={16} strokeWidth={2} />
      <TextInput
        keyboardAppearance="light"
        accessibilityLabel={accessibilityLabel}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={t.placeholder}
        selectionColor={t.accent}
        // Из этой же строки создаётся клиент: автозамена успевала подменить
        // набранное имя до того, как его сохранят.
        autoCorrect={false}
        spellCheck={false}
        autoCapitalize={autoCapitalize}
        autoFocus={autoFocus}
        // Return у поиска — «Найти» и убирает клавиатуру: поиск идёт по
        // мере набора, а «⏎» обещал перенос строки, которого нет.
        returnKeyType="search"
        style={{ flex: 1, fontSize: 15, color: t.ink }}
      />
      {value && onClear ? (
        <Pressable
          onPress={onClear}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Очистить поиск"
          style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}
        >
          <X color={t.placeholder} size={ICON.sm} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Отступ списка шторки — тот же `GUTTER`, что у всего продукта. Экспортируется,
 *  чтобы обёртка списка и строки стояли по одной линии. */
export const SELECT_SIDE = GUTTER;
/** Плитка строки. КВАДРАТНАЯ, как весь продукт: тот же квадрат и тот же
 *  радиус, что у плитки блока «Вид» в списке справочника — один и тот же тег,
 *  счёт или категория обязаны выглядеть одинаково и в списке, и в шторке.
 *  Круглым остаётся ровно одно — аватар клиента с буквой: аватары круглые
 *  везде, и квадратный читался бы не как человек, а как ещё одна сущность. */
const TILE = 28;

export function SelectRow({
  title,
  subtitle,
  hint,
  icon: Icon,
  initial,
  color,
  selected,
  value,
  disabled,
  trailing,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole = "button",
  plain = false,
  image,
  onPress,
  onLongPress,
}: {
  /** Имя сущности — главная строка. */
  title: string;
  /** Вторая строка: телефон, адрес, цена. Узлом — когда это своя строка
   *  истории клиента. */
  subtitle?: ReactNode;
  /** Третья строка: чей это объект, когда список сквозной по клиентам. */
  hint?: string;
  /** Значок в кружке: компонент общего словаря (`icon-set`) ЛИБО эмодзи
   *  строкой — категории операций хранят у владельца именно его (⛽ 🍔 🧰).
   *  Рисуя только компонент, список молча ронял половину значков в запасной
   *  ярлычок, хотя данные были.
   *  Без значка и без `initial` кружка нет вовсе. */
  icon?: LucideIcon | string;
  /** Первая буква имени вместо значка — у клиента. */
  initial?: string;
  /** Цвет сущности: выбранная строка заливает им кружок, прочие — тинтом.
   *  Без цвета кружок берёт акцент (правило плиток типа события). */
  color?: string;
  selected?: boolean;
  /** Число справа ПЕРЕД галкой: остаток счёта, цена. Моноширинные цифры —
   *  столбец значений не должен гулять по ширине при рефетче. */
  value?: string;
  /** Строка есть, но выбрать её нельзя (счёт чужой команды). */
  disabled?: boolean;
  /** Свой орган справа ВМЕСТО галки — степпер количества у услуги. */
  trailing?: ReactNode;
  accessibilityLabel?: string;
  /** Что случится по тапу, для VoiceOver. Нужна там, где строка стоит не в
   *  шторке, а в блоке формы: выбранная категория открывает список заново, и
   *  без подсказки это не слышно (подсказка двери пропала вместе с дверью,
   *  когда выбранное стало строкой шторки). */
  accessibilityHint?: string;
  accessibilityRole?: "button" | "radio" | "checkbox";
  /** БЕЛАЯ ПЛАШКА: цвет сущности — только у плитки, фон строки — белый
   *  (история клиента: фон не заливается,
   *  иконка цветная). По умолчанию — тинт цвета, как у тегов и меток. */
  plain?: boolean;
  /** СНИМОК ВМЕСТО ЗНАЧКА — плитка того же размера показывает само фото
   *  (файлы клиента: фото узнают глазами, а не по слову). */
  image?: string;
  onPress: () => void;
  /** Удержание — второе действие строки (реквизиты: скопировать набор). */
  onLongPress?: () => void;
}) {
  const t = useThemeColors();
  const hasTile = Boolean(Icon || initial || image);
  const emoji = typeof Icon === "string" ? Icon : null;
  // АВАТАР — СВОЙ СЛУЧАЙ: круг, тинт акцента, буква акцентом. Всё остальное —
  // плитка сущности из блока «Вид»: цвет заливкой в полную силу, глиф поверх
  // читаемыми чернилами. Прежний кружок заливался цветом на 15 %, а глиф
  // красил сам цвет — та же сущность в списке (плитка) и в шторке (кружок)
  // выглядела двумя разными вещами.
  const avatar = !Icon && Boolean(initial);
  const fill = avatar ? `${t.accent}1a` : (color ?? t.fill);
  const glyph = avatar
    ? t.accent
    : color
      ? readableTextOnColor(color, t.ink, "#FFFFFF")
      : t.body;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityState={
        accessibilityRole === "checkbox"
          ? { checked: !!selected, disabled: !!disabled }
          : { selected: !!selected, disabled: !!disabled }
      }
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        minHeight: 52,
        paddingHorizontal: 14,
        borderRadius: t.radius.input,
        opacity: disabled ? 0.4 : 1,
        // ЦВЕТ СУЩНОСТИ НЕСЁТ ВСЯ СТРОКА, А НЕ ТОЛЬКО КРУЖОК. Строка без кружка
        // и подсветка одной лишь выбранной выходят скучными: значок и заливка
        // рядом — строка узнаётся целиком, а не пятном 28pt слева.
        //
        // ВЫБРАННАЯ ГРОМЧЕ СВОЕЙ ЖЕ КРАСКОЙ, а не акцентом: перекрашенная в
        // синий, она теряла бы то, чем сущность узнают (закон плиток счетов).
        // Рамки у выбранной нет — признак выбора это заливка и галка
        // (канон шторок выбора, `select-sheet-contract.test.ts`).
        //
        // Строка без своего цвета — клиент, у него аватар с буквой — остаётся
        // на нейтральной подложке: красить нечем и незачем.
        backgroundColor: selected
          ? color
            ? `${color}3d`
            : `${t.accent}14`
          : pressed
            ? t.rowFillPressed
            : plain
              ? t.surface
              : color
                ? `${color}14`
                : t.rowFill,
      })}
    >
      {hasTile ? (
        <View
          style={{
            width: TILE,
            height: TILE,
            borderRadius: avatar ? t.radius.pill : PICKER_RADIUS,
            borderCurve: "continuous",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: fill,
            overflow: image ? "hidden" : undefined,
          }}
        >
          {image ? (
            <Image source={{ uri: image }} style={{ width: TILE, height: TILE }} resizeMode="cover" />
          ) : emoji ? (
            <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 15 }}>
              {emoji}
            </Text>
          ) : Icon ? (
            <Icon color={glyph} size={16} strokeWidth={2} />
          ) : (
            <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 11, fontWeight: "700", color: glyph }}>
              {(initial ?? "?").slice(0, 1).toUpperCase()}
            </Text>
          )}
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={1.3}
          style={{ fontSize: 15, fontWeight: "600", color: t.ink }}
        >
          {title}
        </Text>
        {typeof subtitle === "string" ? (
          subtitle ? (
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}
              style={{ fontSize: 13, color: t.sub }}
            >
              {subtitle}
            </Text>
          ) : null
        ) : (
          subtitle
        )}
        {hint ? (
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
            style={{ fontSize: 13, color: t.faint }}
          >
            {hint}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={1.3}
          style={{
            flexShrink: 0,
            fontSize: 15,
            fontWeight: "600",
            color: t.ink,
            // ТОЛЬКО СТИЛЕМ: `tabular-nums` в className в этом стеке —
            // пустышка (src/lib/nativewind-traps.test.ts).
            fontVariant: ["tabular-nums"],
          }}
        >
          {value}
        </Text>
      ) : null}
      {trailing ??
        (selected ? <Check color={t.accent} size={18} strokeWidth={2.4} /> : null)}
    </Pressable>
  );
}

/** Обёртка списка строк: один ритм и один отступ на все шторки выбора. */
export function SelectList({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        paddingHorizontal: SELECT_SIDE,
        paddingTop: 4,
        paddingBottom: 12,
        gap: 8,
      }}
    >
      {children}
    </View>
  );
}
