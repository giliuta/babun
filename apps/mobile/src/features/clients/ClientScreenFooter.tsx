import { Keyboard, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GradientButton } from "@/components/ui/GradientButton";
import { useKeyboardShown } from "@/lib/keyboard";
import { useThemeColors } from "@/theme/colors";

// ФУТЕР СТРАНИЦЫ КЛИЕНТА — единственное действие экрана внизу, под пальцем.
//
// «Готово» стояло в правом верхнем углу, куда большой палец не дотягивается,
// и было единственным действием продукта наверху: запись, событие, инвойс,
// лист объекта — все давно кончаются плитой внизу. Здесь та же плита и тот
// же рецепт, что у записи (`app/book/index.tsx`, футер): волосок сверху,
// причина словами над кнопкой, отступ снизу по клавиатуре.
//
// ПРИЧИНА ВСЕГДА ВИДНА. Погашенная кнопка молчит, и человек жмёт в неё
// второй и третий раз, не понимая, чего не хватает. Строка над ней говорит
// прямо: «Впишите имя», «Нужен номер телефона», «Такой номер уже есть: Павел
// Иванов». `accessibilityLiveRegion="polite"` — чтобы смена причины
// дочитывалась и с закрытыми глазами, не перебивая набор.
//
// ФУТЕР НИЧЕГО НЕ ЗНАЕТ ПРО ЭКРАН: ни про черновик, ни про дубль, ни про
// запись. Он принимает слово кнопки, причину и обработчик — и поэтому его
// можно поставить куда угодно, где есть ровно одно действие.
//
// Монтируется ВНУТРИ `KeyboardAvoidingView` и ВНЕ прокрутки: иначе кнопка
// уезжает под клавиатуру ровно в тот момент, когда в неё целятся.

export function ClientScreenFooter({
  label,
  reason,
  disabled,
  onPress,
  overTabBar = false,
}: {
  /** Слово на кнопке: «Создать клиента». */
  label: string;
  /** Почему кнопка погашена. Показывается, только пока она погашена: у живой
   *  кнопки причины нет, и пустая строка над ней съедала бы 21pt. */
  reason?: string | null;
  disabled?: boolean;
  onPress: () => void;
  /** Экран стоит во вкладке, и под футером — таб-бар. Нижнюю безопасную
   *  зону тогда уже занял он: свой отступ поднимал кнопку на ~34pt выше, чем
   *  у всех остальных экранов (владелец 22.09: «кнопка сдвинулась вверх, она
   *  должна быть на уровне, где все другие кнопки»). */
  overTabBar?: boolean;
}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const keyboardShown = useKeyboardShown();

  return (
    <View
      style={{
        paddingHorizontal: 14,
        paddingTop: 8,
        // Клавиатура iOS уже включает полосу home-индикатора: с её отступом
        // под кнопкой висели лишние ~34pt пустоты (тот же закон, что у
        // футера листов, DS §5).
        // Над таб-баром — те же 10pt, что у футеров остальных экранов вкладок
        // (услуги, категории, метки).
        paddingBottom: keyboardShown ? 8 : overTabBar ? 10 : insets.bottom + 8,
        backgroundColor: t.canvas,
        borderTopWidth: 1,
        borderTopColor: t.separator,
      }}
    >
      {disabled && reason ? (
        <Text
          accessibilityLiveRegion="polite"
          maxFontSizeMultiplier={1.3}
          style={{
            fontSize: 13,
            color: t.sub,
            textAlign: "center",
            marginBottom: 8,
          }}
        >
          {reason}
        </Text>
      ) : null}
      <GradientButton
        label={label}
        disabled={disabled}
        onPress={() => {
          // КЛАВИАТУРА УХОДИТ ПЕРВОЙ. Поля страницы пишут в черновик на
          // каждый символ, а вот экран под клавиатурой не виден: без этого
          // человек не видит ни ухода на карточку, ни плашки об отказе —
          // кнопка будто не сработала.
          Keyboard.dismiss();
          onPress();
        }}
      />
    </View>
  );
}

export default ClientScreenFooter;
