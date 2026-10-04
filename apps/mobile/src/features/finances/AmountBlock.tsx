import type { ComponentProps, ReactNode } from "react";
import { Text, TextInput, View } from "react-native";
import { SectionCard } from "@/components/ui/SectionCard";
import { useThemeColors } from "@/theme/colors";
import { useMoney } from "@/features/settings/currency";

// БЛОК СУММЫ — ОДИН НА ВСЕ ФОРМЫ ДЕНЕГ (владелец 2026-09-10: «там просто ноль
// показан; сверху подпись „сумма“, чтобы было понимание, что это такое», и
// следом — «операции сделай так же, как долги; берёшь то, что уже имеем»).
//
// ЕВРО СЛЕВА, ВПЛОТНУЮ К ЧИСЛУ. Везде в продукте деньги печатаются «€195» —
// знак идёт первым; в поле он стоял у правой кромки, и глаз шёл к нему через
// пустое поле. «€ 0» читается одним предметом, а курсор встаёт сразу за знаком.
//
// ЧИСЛО — ЧЕРНИЛАМИ, БЕЗ ЦВЕТА СТОРОНЫ (владелец 03.10: «цифры должны
// писаться не зелёными»). Прежде вызывающий красил его направлением денег
// (зелёный доход, красный расход, янтарь долга) — в поле ввода это читалось
// как оценка суммы, а сторону и так называет шапка листа.

export function AmountBlock({
  value,
  onChange,
  title = "Сумма",
  accessibilityLabel,
  hint,
  footer,
  action,
  selectOnFocus = false,
}: {
  value: string;
  onChange: (next: string) => void;
  title?: string;
  accessibilityLabel: string;
  /** Строка под числом, внутри блока: что эта сумма значит сейчас (у
   *  бюджета категории — сколько уже потрачено) или почему она не годится. */
  hint?: { text: string; error?: boolean } | null;
  /** Под числом, внутри того же блока: у операции — строка «Итого» с
   *  клавишей VAT, как в «Итого» записи (владелец 03.10). */
  footer?: ReactNode;
  /** Действие в правом краю шапки блока (у операции — «+ VAT»). */
  action?: ComponentProps<typeof SectionCard>["action"];
  /** Подставленная сумма выделена: первый символ заменяет её целиком (перевод
   *  с готовым остатком). */
  selectOnFocus?: boolean;
}) {
  const t = useThemeColors();
  const currencySymbol = useMoney().symbol;
  return (
    <SectionCard title={title} dense action={action}>
      {/* КЕГЛЬ — САМИМ СТИЛЕМ, А НЕ КЛАССОМ, И БЕЗ ФИКСИРОВАННОЙ ВЫСОТЫ.
          Ноль-подсказка выходил обрезанным сверху — «€ ᴗ» вместо «€ 0». Первая
          попытка (жёсткая высота поля) не помогла: в этом стеке `text-[28px]`
          доезжает до TextInput другим путём, и iOS меряет строку по своему
          кеглю, а не по классовому — глиф не помещался в то, что мы ему
          назначили. Поле само знает свою высоту; наше дело — дать ему воздух.
          Тот же закон уже записан у строки поля: кегль обязан приехать в
          `style` (`src/lib/nativewind-traps.test.ts`). */}
      <View
        className="flex-row items-center gap-1.5 px-4"
        style={{ paddingVertical: 10, minHeight: 48 }}
      >
        <Text
          maxFontSizeMultiplier={1.2}
          // ЗНАК И ЦИФРЫ — В ОДНУ СТРОКУ (владелец 03.10: «выровнять цифры с
          // евро, чтобы не прыгало вверх-вниз»). Поле ввода iOS центрирует
          // текст по метрике шрифта и не слушает `lineHeight`, а `Text` с
          // `lineHeight` ставит глиф иначе — «€» висел на 2–3 точки выше
          // цифр; выравнивание по линии букв поле ввода тоже не умеет. Поэтому
          // межстрочного нет ни у знака, ни у поля: оба центрируются по одной
          // метрике одного кегля. Кегль — обычный, как у строк формы
          // («компактней, не огромные цифры — обычное, как и всё остальное»).
          style={{ fontSize: 17, fontWeight: "600", color: t.sub }}
        >
          {/* Знак валюты компании, а не «€» гвоздём (аудит 2026-09-30). */}
          {currencySymbol}
        </Text>
        <TextInput
          value={value}
          accessibilityLabel={accessibilityLabel}
          onChangeText={onChange}
          keyboardType="decimal-pad"
          selectTextOnFocus={selectOnFocus}
          placeholder="0"
          placeholderTextColor={t.placeholder}
          selectionColor={t.accent}
          keyboardAppearance="light"
          maxFontSizeMultiplier={1.2}
          style={{
            flex: 1,
            fontSize: 17,
            // ВЫСОТА ПОЛЯ — ЧИСЛОМ, С ЗАПАСОМ НАД КЕГЛЕМ. Без неё этот стек
            // давал TextInput строку НИЖЕ кегля, и iOS срезал верх глифов
            // («€ 0» выходило как «€ ᴗ», проба 2026-09-10). Тогда лечили
            // межстрочным, но он сдвигал цифры относительно «€» (03.10).
            // Высота 28 при кегле 17 даёт глифу воздух, а центрирует его
            // само поле — по той же метрике, что и знак рядом.
            height: 28,
            fontWeight: "600",
            padding: 0,
            color: t.ink,
            fontVariant: ["tabular-nums"],
          }}
        />
      </View>
      {hint ? (
        <Text
          accessibilityLiveRegion={hint.error ? "assertive" : "none"}
          maxFontSizeMultiplier={1.2}
          style={{
            paddingHorizontal: 16,
            paddingBottom: 10,
            fontSize: 13,
            lineHeight: 18,
            color: hint.error ? t.danger : t.sub,
          }}
        >
          {hint.text}
        </Text>
      ) : null}
      {footer ? <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>{footer}</View> : null}
    </SectionCard>
  );
}
