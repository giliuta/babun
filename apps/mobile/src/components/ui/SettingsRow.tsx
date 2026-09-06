import type { ComponentType } from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { useThemeColors } from "@/theme/colors";
import { RecordMark } from "./RecordMark";

// СТРОКА-ДВЕРЬ С ПЛИТКОЙ — ОДНА НА ВЕСЬ ПРОДУКТ.
//
// Жила копией внутри каждого экрана настроек, и копии уже разъезжались:
// разная высота, разный размер плитки, где-то подпись, где-то нет. Владелец
// 2026-08-09: «полностью всё одинаковое, чтоб не путаться».
//
// Плитка — навигационный якорь: человек запоминает не текст, а форму и цвет
// значка. ДВА материала плитки, и оба означают ровно одно и то же:
//   • цвет     — страницы настроек, где «зелёная = выгрузка» помогает искать;
//   • neutral  — ДЕНЕЖНЫЕ экраны, где цвет уже занят смыслом «пришло / ушло /
//                внимание». Вид счёта деньгами не является, поэтому его несёт
//                форма глифа, а не пигмент (ТЗ счетов 2026-08-10 §3.5).
// Всё остальное — ритм, кегли, высота, шеврон — у обоих одинаковое.
//
// У НЕЙТРАЛЬНОЙ ПЛИТКИ ДИСКА БОЛЬШЕ НЕТ (2026-08-12). Серый круг 27.4pt
// заливкой ink 6% даёт контраст 1.13:1 с белой карточкой — это ровно та
// фигура и ровно та громкость, которой рисуют ПЛЕЙСХОЛДЕР АВАТАРА: цвета он
// не несёт (запрещено смыслом), формы не имеет (не виден), а строку счёта
// делает похожей на скелетон загрузки. Осталось то, что и несло смысл, —
// глиф: крупнее (20 против 16), полными чернилами и тоньше обводкой, потому
// что теперь его видно. Цветная плитка не меняется: там диск и есть цвет.
//
// Подпись под названием показывает ТЕКУЩЕЕ ЗНАЧЕНИЕ настройки (или состояние
// счёта), чтобы не проваливаться ради проверки; `value` справа — число, ради
// которого строку и читают (остаток счёта).

type IconType = ComponentType<{
  color?: string;
  size?: number;
  strokeWidth?: number;
}>;

/** Значок вида счёта БЕЗ плитки — тот же глиф, что в строке списка. Экспорт
 *  ради героя карточки счёта: значок там обязан быть тем же, что в строке,
 *  иначе один тап отделяет счёт от его же узнаваемого знака. */
export const NEUTRAL_GLYPH = { size: 20, strokeWidth: 1.75 } as const;

export function SettingsRow({
  tile = "neutral",
  swatch,
  icon: Icon,
  title,
  sub,
  subColor,
  value,
  valueColor,
  valueQuiet,
  stacked,
  a11yLabel,
  a11yActions,
  onA11yAction,
  onPress,
  onLongPress,
}: {
  /** Цвет заливки плитки (глиф внутри — белый) либо `"neutral"`: голый глиф
   *  чернилами, без диска. По умолчанию нейтральная — цвет заводится
   *  осознанно, а не забывается. */
  tile?: string | "neutral";
  /** ЦВЕТ ЗАПИСИ КАК ЗНАЧЕНИЕ СТРОКИ. Рисуется НЕ кружком пигмента, а
   *  миниатюрой блока календаря (`RecordMark`): заливка 18 % и кант в полную
   *  силу. Кружок врал — он показывал единственный канал, которого в календаре
   *  нет ни разу (сырой цвет на 100 %), и прятал оба, которые там есть; на
   *  Ванильном #FFF0BC он давал к белой карточке 1.14 : 1, то есть образца
   *  попросту не было видно. Кант держит 4.74 : 1 в худшем случае палитры —
   *  «известный предел 2.00 : 1» закрыт. Читателем ПИГМЕНТА остаётся имя цвета
   *  в `sub`: на 18 % «Оранжевый» и «Медный» — одно пятно. При `swatch` значок
   *  не рисуется, поэтому `icon` в таких строках не передают. */
  swatch?: string | null;
  icon?: IconType;
  title: string;
  /** Текущее значение настройки / состояние счёта, не описание кнопки. */
  sub?: string;
  /** Цвет подписи. Нужен ровно одному состоянию — «Не сверяли 12 дней»
   *  янтарём: касса, которую давно не пересчитывали, просит действия, и
   *  серым это не сказать. По умолчанию `t.caption`. */
  subColor?: string;
  /** Число справа (остаток счёта). Моноширинное: суммы стоят колонкой. */
  value?: string;
  /** Знак числа — единственный цвет в строке: долг красный (`t.danger`). */
  valueColor?: string;
  /** НОЛЬ ТИШЕ ЖИВЫХ ДЕНЕГ: пустая касса печатается тем же тиром, что и
   *  подпись, и обычным весом. «€0» и «€5», набранные одинаково громко,
   *  превращали список в ровный шаблон — глаз не находил, где деньги. */
  valueQuiet?: boolean;
  /** Стопка вместо строки: плитка с названием сверху, подпись и число снизу.
   *  Нужна на крупном системном шрифте (fontScale > 1.35) — в одну строку
   *  название и сумма там уже не помещаются и сумма обрезается первой. */
  stacked?: boolean;
  /** Готовая озвучка строки целиком («Карта Юры, отвечает Юра, остаток €410»),
   *  когда собранная из title/sub/value фраза звучит как перечисление. */
  a11yLabel?: string;
  /** Действия ротора VoiceOver — ТЕ ЖЕ и в том же порядке, что в меню долгого
   *  нажатия. Свайп и долгое нажатие для ротора не существуют: без этого
   *  списка денежное действие оказалось бы доступно только зрячему пальцу. */
  a11yActions?: readonly { name: string; label: string }[];
  onA11yAction?: (name: string) => void;
  /** Отсутствует — строка ЗАГЛУШКА: рисуется, но не нажимается и не
   *  притворяется кнопкой (без роли, без отклика на касание).
   *
   *  Живой контрол над невыполненной функцией — худший вид вранья в
   *  продукте: человек нажимает, уходит уверенный, и узнаёт правду пустым
   *  экраном. Опция здесь, а НЕ вторая строка рядом (закон канона от
   *  2026-08-30): облик строки настроек обязан остаться одним на всё
   *  приложение — расходятся не отступы, расходятся копии. */
  onPress?: () => void;
  /** Меню по долгому нажатию. У жеста ОБЯЗАН быть видимый дублёр словом —
   *  строка, живущая только в долгом нажатии, недостижима ни для VoiceOver,
   *  ни для Voice Control. */
  onLongPress?: () => void;
}) {
  const t = useThemeColors();
  const neutral = tile === "neutral";
  const lines = stacked ? 2 : 1;
  const scale = stacked ? 1.6 : 1.2;

  const tileNode = swatch !== undefined ? (
    <RecordMark hue={swatch} />
  ) : neutral ? (
    // Голый глиф в боксе 20×28: та же высота, что у цветной плитки, поэтому
    // ритм строки и вертикальное выравнивание с текстом не разъезжаются.
    <View style={{ width: 20, height: 28, alignItems: "center", justifyContent: "center" }}>
      {Icon ? (
        <Icon
          color={t.ink}
          size={NEUTRAL_GLYPH.size}
          strokeWidth={NEUTRAL_GLYPH.strokeWidth}
        />
      ) : null}
    </View>
  ) : (
    <View
      style={{
        width: 28,
        height: 28,
        // Круг: w === h. Геометрическое исключение из закона одного радиуса.
        borderRadius: t.radius.pill,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: tile,
      }}
    >
      {Icon ? <Icon color={t.onAccent} size={16} strokeWidth={2} /> : null}
    </View>
  );

  // В стопке название и подпись лежат В РЯД с плиткой и суммой, поэтому им
  // нужна доля ширины; в обычной строке они уже стоят колонкой и flex лишний.
  const grow = stacked ? 1 : undefined;

  // ИМЯ И ЧИСЛО — ОДИН КЕГЛЬ, РАЗНЫЙ ВЕС (2026-08-12). Было 15/600 у обоих:
  // название счёта и его остаток весили одинаково, и строка читалась ровной
  // полосой. 17 — канонический размер строки iOS, а разница 500 ↔ 700 видна с
  // вытянутой руки и говорит «слева вещь, справа её деньги».
  const titleNode = (
    <Text
      maxFontSizeMultiplier={scale}
      numberOfLines={lines}
      style={{
        flex: grow,
        fontSize: 17,
        lineHeight: 22,
        fontWeight: "500",
        color: t.ink,
      }}
    >
      {title}
    </Text>
  );

  const subNode = sub ? (
    <Text
      maxFontSizeMultiplier={scale}
      numberOfLines={lines}
      style={{
        flex: grow,
        // В строке подпись стоит ПОД названием и просит воздуха; в стопке она
        // уже отбита собственным рядом.
        marginTop: stacked ? 0 : 1,
        fontSize: 13,
        lineHeight: 18,
        fontWeight: "500",
        // Описывающее — тише имени, но не «выключено»: подпись счёта читают.
        color: subColor ?? t.caption,
      }}
    >
      {sub}
    </Text>
  ) : null;

  const valueNode = value ? (
    <Text
      maxFontSizeMultiplier={scale}
      numberOfLines={1}
      style={{
        flexShrink: 0,
        fontSize: 17,
        lineHeight: 22,
        fontWeight: valueQuiet ? "500" : "700",
        color: valueColor ?? (valueQuiet ? t.caption : t.ink),
        fontVariant: ["tabular-nums"],
      }}
    >
      {value}
    </Text>
  ) : null;

  const layout = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    // 17/22 имени + 13/18 подписи = 40pt текста; 60 — это те же 10pt
    // воздуха сверху и снизу, что были у строки 15/13 при 56.
    minHeight: 60,
    paddingHorizontal: 16,
    paddingVertical: 10,
  };
  const label = a11yLabel ?? [title, sub, value].filter(Boolean).join(", ");

  // ТЕЛО СТРОКИ — ОДНО НА ОБЕ ВЕТКИ. Написанное дважды, оно уже начало
  // расходиться на первой же правке: в «стопке» плитка стоит ВНУТРИ первого
  // ряда, рядом с названием, и копия про это забыла.
  const body = stacked ? (
    <View style={{ flex: 1, gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        {tileNode}
        {titleNode}
      </View>
      {subNode || valueNode ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          {subNode ?? <View style={{ flex: 1 }} />}
          {valueNode}
        </View>
      ) : null}
    </View>
  ) : (
    <>
      {tileNode}
      <View style={{ flex: 1 }}>
        {titleNode}
        {subNode}
      </View>
      {valueNode}
    </>
  );

  // ЗАГЛУШКА: та же строка, но без роли кнопки, отклика на касание и шеврона.
  // Шеврон обещает, что за строкой что-то есть, — обещать нечего.
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={label} style={layout}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityActions={a11yActions ? [...a11yActions] : undefined}
      onAccessibilityAction={
        onA11yAction
          ? (e) => onA11yAction(e.nativeEvent.actionName)
          : undefined
      }
      style={({ pressed }) => ({
        ...layout,
        // Нажатие УГЛУБЛЯЕТ материал, а не гасит строку прозрачностью.
        backgroundColor: pressed ? t.pressed : "transparent",
      })}
    >
      {body}
      {/* Шеврон — указатель, а не участник строки: −35% массы (18/2.2 → 16/1.75)
          при том же контрасте. Он держится альфой чернил, а не размером. */}
      <ChevronRight color={t.chevron} size={16} strokeWidth={1.75} />
    </Pressable>
  );
}
