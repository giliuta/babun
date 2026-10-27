import { Pressable, Text, View } from "react-native";
import type { ReactNode } from "react";
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
/**
 * «Записи · 12», но просто «Записи», когда их нет.
 *
 * НОЛЬ В СЧЁТЧИКЕ НЕ СЧИТАЕТ, А ПОВТОРЯЕТ. Над пустым списком стояло
 * «ЗАПИСИ · 0», а под ним — «Нет операций за период»: одна и та же мысль
 * дважды, и цифра в ней означала отсутствие. Так это уже делает экран «Не
 * закрыто»; здесь правило становится общим для всех шести панелей.
 */
export function panelCount(label: string, count: number): string {
  return count > 0 ? `${label} · ${count}` : label;
}

export function PanelHeader({
  title,
  right,
  onSettings,
  settingsLabel,
}: {
  title: string;
  /** Что стоит СПРАВА в эйбрау: у долгов это две кнопки сторон (маленькие,
   *  справа).
   *  Полноширинный сегмент над списком занимал строку экрана ради выбора из
   *  двух слов. */
  right?: ReactNode;
  // «ВСЕ» НЕТ: второй тап по плитке и так возвращает полную ленту — вторая
  // дверь к одному жесту не нужна (её нет и у «Счетов»).
  /** Ползунки справа — дверь в НАСТРОЙКИ того, что панель показывает (глиф
   *  — «две палочки с кружочками», как в клиентах). У
   *  «Счетов» это страница «Счета»: порядок, скрытие и правка каждого счёта.
   *  Лента выбранного счёта
   *  значка не несёт: в счёт входят через ту же страницу. Тот же `Settings2`,
   *  что у клиентов: один значок — одно значение на весь продукт. Зона
   *  нажатия — 44pt: высота строки и `hitSlop`. */
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
      {right ? <View className="ml-auto flex-row items-center gap-1.5">{right}</View> : null}
      {onSettings ? (
        <Pressable
          onPress={onSettings}
          accessibilityRole="button"
          accessibilityLabel={settingsLabel ?? "Настройки"}
          hitSlop={8}
          // `ml-auto` только когда слева ничего не заняло место: два элемента
          // с ним разъехались бы по краям и оставили дыру посередине.
          className={`${right ? "" : "ml-auto"} min-h-11 justify-center pl-3 active:opacity-60`}
        >
          <Settings2 color={t.sub} size={ICON.command} strokeWidth={2} />
        </Pressable>
      ) : null}
    </View>
  );
}
