import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { GUTTER } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { capsText } from "../caps-text";

/** Отступ карточки от краёв экрана — один на все группы и на весь продукт
 *  (`GUTTER`, DS §3). Был 12 при документе, обещающем 16. */
const GROUP_INSET = GUTTER;

/** Шапка группы: риска · капс-заголовок · подытог справа.
 *
 *  Живёт отдельным экспортом, потому что в `SectionList` заголовок, строки и
 *  футер приезжают ТРЕМЯ разными слотами, а выглядеть обязаны одной карточкой.
 *  Второй вёрстки заголовка в продукте быть не должно — «один дизайн на все
 *  списки». */
export function RowGroupHeader({
  title,
  accent,
  value,
  action,
}: {
  title?: string;
  accent?: string | null;
  value?: string;
  /** Команда СПРАВА ОТ ЭЙБРАУ, на одной с ним строке.
   *  Место для «＋», который дописывает в группу ещё один блок: контрол в
   *  конце длинного списка требует прокрутки до конца, чтобы сделать то, что
   *  видно сверху. */
  action?: ReactNode;
}) {
  const t = useThemeColors();
  return (
    <View
      // С подытогом заголовок читается ОДНОЙ остановкой VoiceOver:
      // «Команда Юра, 1050 евро». Двумя он звучал как обрывок фразы и
      // сумма повисала без хозяина.
      accessible={!!value}
      accessibilityRole={value ? "header" : undefined}
      accessibilityLabel={
        value ? [title, value].filter(Boolean).join(", ") : undefined
      }
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginBottom: 6,
        marginHorizontal: GROUP_INSET + 4,
      }}
    >
      {accent ? (
        <View
          // Декорация: цвет уже назван словом в заголовке рядом.
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            width: 2,
            height: 16,
            borderRadius: 1,
            backgroundColor: accent,
          }}
        />
      ) : null}
      {title ? (
        <Text
          // Заголовок раздела: VoiceOver умеет прыгать по заголовкам, а без
          // роли группы карточки читались одним нерасчленимым потоком.
          //
          // ЦВЕТ — ОПИСЫВАЮЩИЙ, А НЕ ПОЛНЫЙ ЧЁРНЫЙ. Капс-ярлык
          // группы НАЗЫВАЕТ раздел, но именем и числом не является: набранный
          // полным ink, он весил больше строк, которые подписывает, — на
          // экране счетов подпись героя несла в 1.6 раза больше чернил, чем
          // сумма под ней. Уточнение правила («серым не помечай
          // главные слова»): серого пигмента здесь и нет — те же чернила
          // тише, а полный чёрный остаётся у ИМЁН и ЧИСЕЛ. Разрядка 1.4 → 0.8:
          // на 11pt широкий трекинг рассыпает слово на буквы и добавляет
          // ширины, которую глаз считает за вес. Второй капс-примитив продукта
          // (`SectionCard`) печатает эйбрау так же тихо — теперь они сходятся.
          accessibilityRole="header"
          maxFontSizeMultiplier={1.3}
          numberOfLines={1}
          style={{
            flex: 1,
            fontSize: 11,
            lineHeight: 14,
            fontWeight: "700",
            letterSpacing: 0.8,
            color: t.caption,
          }}
        >
          {capsText(title)}
        </Text>
      ) : null}
      {action ?? null}
      {value ? (
        <Text
          maxFontSizeMultiplier={1.3}
          numberOfLines={1}
          style={{
            fontSize: 13,
            fontWeight: "600",
            color: t.ink,
            fontVariant: ["tabular-nums"],
          }}
        >
          {value}
        </Text>
      ) : null}
    </View>
  );
}

/** Белое тело карточки. `first`/`last` — какие края скругляет ЭТОТ кусок:
 *  собранная из строк списка карточка приходит по частям, но округляется
 *  ровно один раз сверху и один раз снизу.
 *
 *  МАТЕРИАЛ ТОТ ЖЕ, ЧТО У `Card`. Две одинаковые на вид белые
 *  поверхности продукта были из РАЗНОЙ материи: у `Card` тень и стеклянная
 *  кромка, у этой — ничего. Поэтому карточка счёта не имела края и читалась
 *  как серый прямоугольник загрузки — «скелетон», а не вещь. */
export function RowGroupBody({
  first = true,
  last = true,
  children,
}: {
  first?: boolean;
  last?: boolean;
  children: ReactNode;
}) {
  const t = useThemeColors();
  const r = t.radius.card;
  return (
    <View
      style={{
        marginHorizontal: GROUP_INSET,
        overflow: "hidden",
        backgroundColor: t.surface,
        boxShadow: t.cardShadow,
        borderCurve: "continuous",
        borderTopLeftRadius: first ? r : 0,
        borderTopRightRadius: first ? r : 0,
        borderBottomLeftRadius: last ? r : 0,
        borderBottomRightRadius: last ? r : 0,
      }}
    >
      {/* Волосяная светлая кромка = толщина стекла. Только у ВЕРХНЕГО куска:
          в середине склеенной карточки она стала бы лишним швом. */}
      {first ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 1,
            backgroundColor: t.highlight,
          }}
        />
      ) : null}
      {children}
    </View>
  );
}

/** Пояснение ПОД карточкой: тише строк и не кликается. */
function RowGroupFooter({ text }: { text: string }) {
  const t = useThemeColors();
  return (
    <Text
      maxFontSizeMultiplier={1.3}
      style={{
        marginTop: 6,
        marginHorizontal: GROUP_INSET + 4,
        fontSize: 13,
        lineHeight: 18,
        color: t.faint,
      }}
    >
      {text}
    </Text>
  );
}

export function RowGroup({
  title,
  accent,
  value,
  footer,
  children,
}: {
  /** Капс-надпись НАД группой; без неё группа безымянная.
   *
   *  НЕ ДЛЯ ИМЕНОВАННОГО БЛОКА ЭКРАНА. Блок с именем — это
   *  `SectionCard`: подпись внутри белого, там же справа её команда. Именно
   *  из-за выбора между этими двумя примитивами карточка клиента и страница
   *  записи рисовали один и тот же блок двумя способами. За `RowGroup`
   *  осталась его настоящая работа — секция с подытогом справа и пояснением
   *  под ней («БРИГАДА ЮРА … €1 050»), то есть финансы. */
  title?: string;
  /** Риска 2×16 слева от заголовка цветом сущности (цвет команды). Связывает
   *  секцию с выбранным наверху чипом быстрее, чем прочитанное слово. */
  accent?: string | null;
  /** Подытог СПРАВА в заголовке — сумма строк, которые лежат под ним
   *  («БРИГАДА ЮРА … €1 050»). Цифры моноширинные: подытоги секций стоят
   *  друг под другом и при рефетче не должны гулять по ширине. */
  value?: string;
  /** Пояснение ПОД группой: «Наличными €640 · На картах €410». */
  footer?: string;
  children: ReactNode;
}) {
  return (
    <View style={{ marginTop: 12 }}>
      {title || value ? (
        <RowGroupHeader title={title} accent={accent} value={value} />
      ) : null}
      <RowGroupBody>{children}</RowGroupBody>
      {footer ? <RowGroupFooter text={footer} /> : null}
    </View>
  );
}
