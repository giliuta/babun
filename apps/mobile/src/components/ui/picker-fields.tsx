import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { useThemeColors } from "@/theme/colors";
import { AppearanceSheet, AppearanceTile } from "./AppearanceSheet";
import { FieldLabel } from "./Field";
import { iconPreset, type IconPreset } from "./icon-set";
import { ICON } from "./tokens";

/** Точка цвета — оттиск ответа в строке. Пустой цвет не рисует ничего, только
 *  держит место: обводка-заготовка читалась как «белый уже выбран». */
export function ColorDot({ value, size = 22 }: { value?: string | null; size?: number }) {
  const t = useThemeColors();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        backgroundColor: value ?? "transparent",
        borderWidth: value ? StyleSheet.hairlineWidth : 0,
        borderColor: t.separator,
      }}
    />
  );
}

/** Глиф выбранного значка — оттиск ответа в строке. */
export function IconGlyph({
  value,
  color,
  size = 22,
  icons,
}: {
  value?: string | null;
  color?: string | null;
  size?: number;
  /** Набор-переопределение — тот же, что отдан пикеру: иначе значок в строке
   *  и значок в решётке брались бы из разных наборов. */
  icons?: readonly IconPreset[];
}) {
  const t = useThemeColors();
  const Glyph = icons
    ? icons.find((i) => i.value === value)?.icon ?? null
    : iconPreset(value);
  if (!Glyph) return <View style={{ width: size, height: size }} />;
  return <Glyph color={color ?? t.ink} size={size} strokeWidth={2} />;
}

/** СТРОКА «ВИД» — образец и одна шторка на цвет и значок. Раньше это были два
 *  поля, каждое со своей плавающей решёткой; вопрос у них один, и владелец
 *  2026-09-10 попросил свести их в один блок с переключателем внутри. */
export function AppearanceField({
  color,
  onColorChange,
  icon,
  onIconChange,
  icons,
  colors,
  label = "Вид",
  disabled,
}: {
  color: string | null | undefined;
  onColorChange: (hex: string) => void;
  icon?: string | null;
  onIconChange?: (slug: string | null) => void;
  icons?: readonly IconPreset[];
  colors?: readonly string[];
  label?: string;
  disabled?: boolean;
}) {
  const t = useThemeColors();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ marginBottom: 16 }}>
      <FieldLabel text={label} />
      <Pressable
        onPress={disabled ? undefined : () => setOpen(true)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          minHeight: 52,
          paddingHorizontal: 12,
          borderRadius: t.radius.input,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: t.separator,
          opacity: pressed ? 0.6 : disabled ? 0.4 : 1,
        })}
      >
        <AppearanceTile color={color} icon={icon} icons={icons} />
        <View style={{ flex: 1 }} />
        <ChevronRight color={t.chevron} size={ICON.sm} />
      </Pressable>
      <AppearanceSheet
        visible={open}
        onClose={() => setOpen(false)}
        color={color}
        onColorChange={onColorChange}
        colors={colors}
        icon={icon}
        onIconChange={onIconChange}
        icons={icons}
        initial={onIconChange ? "icon" : "color"}
      />
    </View>
  );
}

/** ИМЯ БЕЗ ЦВЕТА — та же рамка и та же кнопка у подписи, что у
 *  `NameColorField`, только без точки и палитры. Нужна там, где у сущности
 *  цвета нет: у услуги его сняли 2026-09-08 («он вообще не нужен»), а поле с
 *  «＋ Описание» у подписи осталось — обычный `Field` этой кнопки не знает. */
export function NameField({
  name,
  onNameChange,
  label = "Название",
  autoFocus,
  maxLength,
  onBlur,
  labelAction,
}: {
  name: string;
  onNameChange: (value: string) => void;
  label?: string | null;
  autoFocus?: boolean;
  maxLength?: number;
  onBlur?: () => void;
  labelAction?: ReactNode;
}) {
  const t = useThemeColors();
  return (
    <View style={{ marginBottom: 16 }}>
      {label ? (
        labelAction ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <FieldLabel text={label} />
            {labelAction}
          </View>
        ) : (
          <FieldLabel text={label} />
        )
      ) : null}
      <View
        style={{
          borderRadius: t.radius.input,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: t.separator,
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: 16,
        }}
      >
        <TextInput
          value={name}
          onChangeText={onNameChange}
          accessibilityLabel={label ?? "Название"}
          placeholderTextColor={t.placeholder}
          selectionColor={t.accent}
          keyboardAppearance="light"
          autoFocus={autoFocus}
          maxLength={maxLength}
          onBlur={onBlur}
          returnKeyType="done"
          onSubmitEditing={onBlur}
          style={{
            flex: 1,
            minHeight: 48,
            paddingRight: 16,
            paddingVertical: 12,
            fontSize: 15,
            color: t.ink,
          }}
        />
      </View>
    </View>
  );
}

/**
 * ИМЯ И ЕГО ЦВЕТ — ОДНА СТРОКА (владелец 2026-08-18: «поставь цвет в название
 * справа»). Отдельная строка «Цвет» под названием спрашивала во второй раз про
 * то же самое: как эта штука будет выглядеть в списке. Точка стоит в правом
 * краю поля ввода, тап по ней раскрывает решётку прямо под строкой — тот же
 * жест, что у `ColorField`.
 *
 * Блок общий: имя с цветом есть у услуги, метки, тега, категории и типа
 * события — второго способа спросить об этом в продукте быть не должно.
 */
export function NameColorField({
  name,
  onNameChange,
  color,
  onColorChange,
  label = "Название",
  autoFocus,
  maxLength,
  onBlur,
  bare,
  labelAction,
  icon,
  onIconChange,
  icons,
}: {
  name: string;
  onNameChange: (value: string) => void;
  color: string | null | undefined;
  onColorChange: (hex: string) => void;
  /** `null` — строка идёт без ярлыка: она стоит В КАРТОЧКЕ, которую уже
   *  назвали сверху. */
  label?: string | null;
  /** СТРОКА КАРТОЧКИ, А НЕ ПОЛЕ ФОРМЫ: без своей рамки и своего ярлыка. Так
   *  имя команды правится прямо там, где написано (владелец 2026-08-18: «не
   *  надо, чтобы снизу выплывало — можно было прям сразу так и менять»). */
  bare?: boolean;
  autoFocus?: boolean;
  maxLength?: number;
  /** Экраны, где имя пишется сразу (хаб команды), коммитят его по завершении
   *  ввода — блок обязан отдавать этот момент наружу. */
  onBlur?: () => void;
  /** Кнопка СПРАВА ОТ ПОДПИСИ, на одной с ней строке (владелец 2026-08-24:
   *  «название, а с правой стороны — плюс описание»). Место для команды,
   *  которая дописывает к имени что-то необязательное: она стоит у ярлыка, а
   *  не под полем, и поэтому не выглядит частью самого поля. */
  labelAction?: ReactNode;
  /** ЗНАЧОК — ТОТ ЖЕ ВОПРОС, ЧТО ЦВЕТ, и живёт в той же шторке (владелец
   *  2026-09-10: «точно такой же блок я хочу сделать с иконками»). Сущности без
   *  значка этих пропов не передают — переключателя в шторке тогда нет. */
  icon?: string | null;
  onIconChange?: (slug: string | null) => void;
  icons?: readonly IconPreset[];
}) {
  const t = useThemeColors();
  const [open, setOpen] = useState(false);

  return (
    // ВЫБОР ПРИЕЗЖАЕТ ШТОРКОЙ, А НЕ РАСТЁТ ИЗ СТРОКИ. Плавающая карточка над
    // формой умела ровно одно — цвет; со значком в том же вопросе она стала бы
    // ВТОРОЙ анатомией выбора. Шторка у нас уже есть, она одна на продукт и
    // знает про шапку, высоту, прокрутку и нижний отступ.
    <View style={{ marginBottom: bare ? 0 : 16 }}>
      {label && !bare ? (
        labelAction ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <FieldLabel text={label} />
            {labelAction}
          </View>
        ) : (
          <FieldLabel text={label} />
        )
      ) : null}
      <View
        style={{
          ...(bare
            ? { minHeight: 52 }
            : {
                borderRadius: t.radius.input,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: t.separator,
              }),
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: 16,
        }}
      >
        {/* ОБРАЗЕЦ СЛЕВА — ТАМ ЖЕ, ГДЕ В СПИСКЕ (владелец 2026-08-18: «в
            списке она слева, давай и в настройках слева, чтобы проще для глаз
            — люди и так замотанные»). Плитка показывает ответ целиком: цвет
            заливкой, значок внутри неё. */}
        <Pressable
          onPress={() => setOpen(true)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={onIconChange ? "Цвет и значок" : "Цвет"}
          style={({ pressed }) => ({
            paddingVertical: 12,
            paddingRight: 12,
            opacity: pressed ? 0.5 : 1,
          })}
        >
          <AppearanceTile color={color} icon={icon} icons={icons} size={28} />
        </Pressable>
        <TextInput
          value={name}
          onChangeText={onNameChange}
          accessibilityLabel={label ?? "Название"}
          placeholderTextColor={t.placeholder}
          selectionColor={t.accent}
          keyboardAppearance="light"
          autoFocus={autoFocus}
          maxLength={maxLength}
          onBlur={onBlur}
          returnKeyType="done"
          onSubmitEditing={onBlur}
          style={{
            flex: 1,
            minHeight: 48,
            paddingRight: 16,
            paddingVertical: 12,
            fontSize: bare ? 17 : 16,
            fontWeight: bare ? "600" : "400",
            color: t.ink,
          }}
        />
      </View>

      <AppearanceSheet
        visible={open}
        onClose={() => setOpen(false)}
        color={color}
        onColorChange={onColorChange}
        icon={icon}
        onIconChange={onIconChange}
        icons={icons}
      />
    </View>
  );
}
