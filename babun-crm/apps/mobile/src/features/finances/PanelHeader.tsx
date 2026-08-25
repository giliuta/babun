import { Pressable, Text, View } from "react-native";
import { Settings2 } from "lucide-react-native";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";

/**
 * ЭЙБРАУ ПАНЕЛИ — ОДИН НА ВСЕ РАЗРЕЗЫ «ФИНАНСОВ».
 *
 * Ряд переключателей и то, что он раскрывает, разделены только воздухом. Без
 * имени панель читалась как продолжение сводки: под «Прибылью» вдруг лежали
 * счета, и было непонятно, ответ на какой вопрос перед тобой. Капс-строка
 * называет панель и, где число осмысленно, считает её строки («ОПЕРАЦИИ · 12»).
 *
 * Вёрстка здесь ровно одна, потому что панелей шесть: счета, документы, доход,
 * расход, долги и прибыль обязаны выглядеть одним объектом, а не шестью.
 */
export function PanelHeader({
  title,
  onReset,
  onSettings,
  settingsLabel,
}: {
  title: string;
  /** «Все» — снять разрез и вернуть полную ленту. Есть только там, где разрез
   *  что-то прячет: панель, показывающая всё, сбрасывать не от чего. */
  onReset?: () => void;
  /** Шестерёнка-ползунки справа — дверь в НАСТРОЙКИ этой панели (владелец
   *  2026-08-15: «справа поставь эти две палочки с кружочками, как в клиентах,
   *  и оно переводит в настройку счетов»). Тот же глиф `Settings2`, что в шапке
   *  страницы счетов и у клиентов: один значок — одно значение на весь продукт. */
  onSettings?: () => void;
  /** Что именно настраивают — для озвучки. Без неё VoiceOver слышит «кнопка». */
  settingsLabel?: string;
}) {
  const t = useThemeColors();
  return (
    <View className="flex-row items-center px-4 pb-1 pt-2">
      <Text
        className="text-xs font-semibold uppercase tracking-wider"
        // `caption` — единые чернила капс-подписей денежных экранов:
        // описывающее — тише того, что называет (см. обоснование в colors.ts).
        style={{ color: t.caption }}
      >
        {title}
      </Text>
      {onReset ? (
        <Pressable
          onPress={onReset}
          accessibilityRole="button"
          accessibilityLabel="Показать все операции"
          className="ml-auto min-h-11 justify-center px-2 active:opacity-60"
        >
          <Text className="text-[13px] font-semibold" style={{ color: t.accent }}>
            Все
          </Text>
        </Pressable>
      ) : null}
      {onSettings ? (
        <Pressable
          onPress={onSettings}
          accessibilityRole="button"
          accessibilityLabel={settingsLabel ?? "Настройки"}
          hitSlop={8}
          // `ml-auto` только когда слева ничего не заняло место: два элемента
          // с ним разъехались бы по краям и оставили дыру посередине.
          className={`${onReset ? "" : "ml-auto"} min-h-11 justify-center pl-3 active:opacity-60`}
        >
          <Settings2 color={t.sub} size={ICON.sm} strokeWidth={2} />
        </Pressable>
      ) : null}
    </View>
  );
}
