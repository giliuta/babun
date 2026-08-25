import { useCallback, useRef, useState, type ReactNode } from "react";
import {
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { useThemeColors } from "@/theme/colors";
import { ColorPicker } from "./ColorPicker";
import { Divider } from "./Divider";
import { IconPicker } from "./IconPicker";
import { FieldLabel } from "./Field";
import { iconPreset } from "./icon-set";
import { ICON } from "./tokens";

/** Высота плавающей карточки выбора: пять рядов по 42 плюс поля. Точная
 *  величина не нужна — нужен ответ «влезет ли вниз». */
const FLOAT_H = 260;

/** ГДЕ РИСОВАТЬ ВЫБОР: НАД ФОРМОЙ ИЛИ ВНУТРИ НЕЁ.
 *
 *  По умолчанию карточка ложится поверх, чтобы форма не прыгала. Но в коротком
 *  листе (имя команды и кнопка) строка стоит у самого низа: снизу карточка
 *  уезжает за экран, а сверху её обрезает край листа — видно два ряда из пяти.
 *  Тогда решётка раскрывается ВНУТРИ строки: нижний лист растёт вверх сам, и
 *  сдвигать ему нечего.
 *
 *  Меряем якорь в момент открытия — это честнее, чем гадать по числу полей. */
function usePlacement() {
  const ref = useRef<View>(null);
  const [inline, setInline] = useState(false);
  const measure = useCallback(() => {
    ref.current?.measureInWindow((_x, y, _w, h) => {
      const screen = Dimensions.get("window").height;
      setInline(y + h + FLOAT_H > screen - 24);
    });
  }, []);
  return { ref, inline, measure };
}

// ЦВЕТ И ЗНАЧОК В ФОРМЕ — СТРОКА, КОТОРАЯ ОТКРЫВАЕТСЯ (владелец 2026-08-17:
// «тап на цвет — и открывается вся диаграмма цветов, то же самое как мы делали
// с графиком: тап на время и открывается»). Сорок точек и сорок значков, лежащие
// в форме нараспашку, забивали её собой: у листа с двумя вопросами треть высоты
// уходила в палитру.
//
// ОТВЕТ ПОКАЗЫВАЕТ СЕБЯ, А НЕ СВОЁ ИМЯ (владелец 2026-08-17: «зачем это
// опознавать… это же бред — называть цвет ещё „Голубой“, и так всё понятно»).
// Строка говорит «Цвет» / «Значок», справа стоит сама точка или сам глиф.
// Названия оттенков живут только в озвучке VoiceOver, где картинку не видно.
//
// Рамка та же, что у `Field`: форма обязана звучать одним голосом, поэтому
// строка выбора выглядит как поле ввода, а не как отдельный жанр.
export function DisclosureField({
  label,
  valueText,
  accessory,
  disabled,
  float,
  children,
}: {
  label: string;
  /** Ответ СЛОВАМИ — только там, где показать его собой нечем (себестоимость
   *  и ступени цены). У цвета и значка ответ рисуется оттиском, и слова были
   *  бы шумом: владелец 2026-08-17 — «зачем называть цвет ещё „Голубой“». */
  valueText?: string;
  /** Действующий ответ — сам собой: точка цвета или глиф. Пусто — ничего. */
  accessory?: ReactNode;
  disabled?: boolean;
  /** ВЫБОР НАКРЫВАЕТ ФОРМУ, А НЕ РАЗДВИГАЕТ ЕЁ (владелец 2026-08-18). Решётка
   *  цвета или значка — 220pt: раскрытая внутри строки, она сдвигала вниз всё
   *  остальное, и человек терял место, куда смотрел. Плавающей карточкой она
   *  висит НАД формой и закрывается сразу после выбора.
   *
   *  Для редакторов (опт, расход, название в документах) это выключено: там
   *  внутри поля ввода, и накрывать ими форму, пока набираешь, — хуже. */
  float?: boolean;
  /** Редактор — рисуется ПОД строкой, внутри той же рамки. */
  children: ReactNode;
}) {
  const t = useThemeColors();
  const [open, setOpen] = useState(false);
  const place = usePlacement();

  return (
    <View
      ref={place.ref}
      style={{ marginBottom: 16, zIndex: float && open ? 20 : 0 }}
    >
      <View
        style={{
          borderRadius: t.radius.input,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: t.separator,
          overflow: float ? "visible" : "hidden",
        }}
      >
        <Pressable
          onPress={
            disabled
              ? undefined
              : () => {
                  place.measure();
                  setOpen((v) => !v);
                }
          }
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={valueText ? `${label}: ${valueText}` : label}
          accessibilityState={{ expanded: open, disabled: !!disabled }}
          style={({ pressed }) => ({
            minHeight: 48,
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 16,
            paddingVertical: 10,
            opacity: disabled ? 0.4 : 1,
            backgroundColor: pressed ? t.pressed : "transparent",
          })}
        >
          <Text
            maxFontSizeMultiplier={1.3}
            numberOfLines={1}
            style={{ fontSize: 16, color: open ? t.accent : t.ink }}
          >
            {label}
          </Text>
          <View style={{ flex: 1, minWidth: 8 }} />
          {valueText ? (
            <Text
              maxFontSizeMultiplier={1.3}
              numberOfLines={1}
              style={{ flexShrink: 1, fontSize: 16, color: t.faint }}
            >
              {valueText}
            </Text>
          ) : null}
          {accessory ? (
            <View style={{ marginRight: 10 }}>{accessory}</View>
          ) : (
            <View style={{ width: 10 }} />
          )}
          {open ? (
            <ChevronDown color={t.accent} size={ICON.sm} />
          ) : (
            <ChevronRight color={t.chevron} size={ICON.sm} />
          )}
        </Pressable>
        {open && (!float || place.inline) ? (
          <>
            <Divider />
            <View style={{ paddingHorizontal: 12, paddingTop: 10 }}>
              {children}
            </View>
          </>
        ) : null}
      </View>

      {open && float && !place.inline ? (
        <>
          {/* Тап мимо закрывает выбор. Слой лежит ПОД карточкой и не
              перехватывает сам выбор. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Закрыть выбор: ${label}`}
            onPress={() => setOpen(false)}
            style={{
              position: "absolute",
              top: -800,
              bottom: -800,
              left: -800,
              right: -800,
              zIndex: 10,
            }}
          />
          <View
            style={{
              position: "absolute",
              top: "100%",
              marginTop: 6,
              left: 0,
              right: 0,
              zIndex: 20,
              borderRadius: t.radius.card,
              borderCurve: "continuous",
              backgroundColor: t.surface,
              paddingHorizontal: 12,
              paddingTop: 12,
              shadowColor: "#0b1220",
              shadowOpacity: 0.16,
              shadowRadius: 24,
              shadowOffset: { width: 0, height: 12 },
            }}
          >
            {children}
          </View>
        </>
      ) : null}
    </View>
  );
}

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
}: {
  value?: string | null;
  color?: string | null;
  size?: number;
}) {
  const t = useThemeColors();
  const Glyph = iconPreset(value);
  if (!Glyph) return <View style={{ width: size, height: size }} />;
  return <Glyph color={color ?? t.ink} size={size} strokeWidth={2} />;
}

export function ColorField({
  value,
  onChange,
  label = "Цвет",
  colors,
  disabled,
}: {
  value: string | null | undefined;
  onChange: (hex: string) => void;
  label?: string;
  colors?: readonly string[];
  disabled?: boolean;
}) {
  return (
    <DisclosureField
      label={label}
      disabled={disabled}
      float
      accessory={<ColorDot value={value} />}
    >
      <ColorPicker
        label={null}
        value={value}
        onChange={onChange}
        colors={colors}
        disabled={disabled}
      />
    </DisclosureField>
  );
}

export function IconField({
  value,
  onChange,
  label = "Значок",
  tint,
  disabled,
}: {
  value: string | null | undefined;
  onChange: (slug: string) => void;
  label?: string;
  /** Цвет заливки выбранного значка — обычно цвет самой сущности. */
  tint?: string | null;
  disabled?: boolean;
}) {
  return (
    <DisclosureField
      label={label}
      disabled={disabled}
      float
      accessory={<IconGlyph value={value} color={tint} />}
    >
      <IconPicker
        label={null}
        value={value}
        onChange={onChange}
        tint={tint}
        disabled={disabled}
      />
    </DisclosureField>
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
}) {
  const t = useThemeColors();
  const [open, setOpen] = useState(false);
  const place = usePlacement();

  return (
    // ПАЛИТРА НАКРЫВАЕТ ФОРМУ, А НЕ РАЗДВИГАЕТ ЕЁ (владелец 2026-08-18: «оно не
    // поднимается всю услугу вверх, а грубо говоря настилается, как попап, и
    // прям от этого цвета»). Раскрывашка внутри строки толкала цену, время и
    // всё остальное вниз на 220pt — человек терял место, куда смотрел, и
    // возвращался к нему прокруткой. Плавающая карточка висит НАД формой,
    // растёт от самой точки и закрывается сразу после выбора: цвет выбирают
    // один раз и уходят дальше.
    <View
      ref={place.ref}
      style={{ marginBottom: bare ? 0 : 16, zIndex: open ? 20 : 0 }}
    >
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
        {/* ТОЧКА СЛЕВА — ТАМ ЖЕ, ГДЕ В СПИСКЕ (владелец 2026-08-18: «в списке
            она слева, давай и в настройках слева, чтобы проще для глаз — люди
            и так замотанные»). Правка услуги открывается из строки, где цвет
            стоит первым: пусть глаз находит его на том же месте, а не ищет
            заново. */}
        <Pressable
          onPress={() => {
            place.measure();
            setOpen((v) => !v);
          }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Цвет"
          accessibilityState={{ expanded: open }}
          style={({ pressed }) => ({
            paddingVertical: 12,
            paddingRight: 12,
            opacity: pressed ? 0.5 : 1,
          })}
        >
          <ColorDot value={color} size={18} />
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

      {open && (place.inline || bare) ? (
        // РЕШЁТКА ЖИВЁТ ВНУТРИ. Так — всегда в строке карточки (`bare`):
        // карточка настроек режет всё, что вылезает за её скруглённые края, и
        // плавающая палитра там просто не видна. Карточка вместо этого
        // подрастает, а страница прокручивается.
        //
        // И так же — когда снизу нет места: нижний лист растёт вверх сам.
        <View
          style={{
            marginTop: bare ? 0 : 6,
            ...(bare
              ? { paddingHorizontal: 4 }
              : {
                  borderRadius: t.radius.card,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: t.separator,
                  paddingHorizontal: 12,
                }),
            paddingTop: bare ? 4 : 12,
          }}
        >
          <ColorPicker
            label={null}
            value={color}
            onChange={(hex) => {
              onColorChange(hex);
              setOpen(false);
            }}
          />
        </View>
      ) : null}

      {open && !place.inline && !bare ? (
        <>
          {/* Тап мимо палитры закрывает её. Прозрачный слой лежит ПОД
              карточкой и не перехватывает выбор цвета. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Закрыть выбор цвета"
            onPress={() => setOpen(false)}
            style={{
              position: "absolute",
              top: -800,
              bottom: -800,
              left: -800,
              right: -800,
              zIndex: 10,
            }}
          />
          <View
            style={{
              position: "absolute",
              top: "100%",
              marginTop: 6,
              left: 0,
              right: 0,
              zIndex: 20,
              borderRadius: t.radius.card,
              borderCurve: "continuous",
              backgroundColor: t.surface,
              paddingHorizontal: 12,
              paddingTop: 12,
              // Тень — то, что отличает «лежит сверху» от «встроено в форму».
              shadowColor: "#0b1220",
              shadowOpacity: 0.16,
              shadowRadius: 24,
              shadowOffset: { width: 0, height: 12 },
            }}
          >
            <ColorPicker
              label={null}
              value={color}
              onChange={(hex) => {
                onColorChange(hex);
                // Цвет выбран — вопрос закрыт. Держать палитру открытой значит
                // ждать от человека второго решения, которого нет.
                setOpen(false);
              }}
            />
          </View>
        </>
      ) : null}
    </View>
  );
}
