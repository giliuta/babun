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
// Цвет числа задаёт вызывающий: у долга он по стороне (янтарь — должны нам,
// красный — должны мы), у операции по направлению (зелёный доход, красный
// расход). Сам блок про смысл денег ничего не знает и знать не должен.

export function AmountBlock({
  value,
  onChange,
  color,
  title = "Сумма",
  accessibilityLabel,
  hint,
  footer,
  action,
  selectOnFocus = false,
}: {
  value: string;
  onChange: (next: string) => void;
  color: string;
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
        style={{ paddingVertical: 8, minHeight: 56 }}
      >
        <Text
          maxFontSizeMultiplier={1.2}
          style={{ fontSize: 28, fontWeight: "700", color: t.faint }}
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
            fontSize: 28,
            // МЕЖСТРОЧНЫЙ ИНТЕРВАЛ ОБЯЗАТЕЛЕН У КРУПНОГО ПОЛЯ ВВОДА.
            // Без него этот стек даёт TextInput строку НИЖЕ кегля, и iOS
            // срезает верхнюю половину глифов: «€ 0» выходило как «€ ᴗ».
            // Найдено пробой 2026-09-10 — подсказка «0 8 5 X» отрисовалась
            // как «ᴜ ȣ Ɔ ʌ», то есть резало ВСЕ знаки одинаково, а не глиф
            // нуля. Соседний «€» — обычный `Text` — при том же кегле цел.
            // Раньше кегль приходил классом `text-3xl`, который несёт
            // интервал с собой, и код работал случайно; арбитрарный
            // `text-[28px]` интервала не несёт. Держим числом рядом с кеглем.
            lineHeight: 36,
            fontWeight: "700",
            padding: 0,
            color,
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
