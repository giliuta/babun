// ProfileSection — плоская секция карточки клиента («Профиль»).
//
// БЫЛО: сворачивающаяся карточка «Диспетчера» — строка «Контакты … Пусто ›»,
// тап разворачивает. У свежесозданного клиента экран превращался в столбик
// из шести «Пусто ›», и владелец справедливо назвал это неготовым.
//
// СТАЛО (решение владельца 2026-07-25): содержимое всегда на виду, тапать
// нечего. Заголовок — тихий caps-eyebrow НАД карточкой (Halo Cobalt:
// 11/700, tracking 1.4), справа в той же строке — короткая сводка, если
// блоку есть что сказать. Никаких шевронов и слова «Пусто» в интерфейсе.
//
// Пустые секции не рисуются вообще (`hideWhenEmpty`): пустая рамка ничего
// не сообщает, а место занимает. Блоки, которые СЛУЖАТ вводом (объекты,
// контакты в черновике), этот флаг не ставят — им надо показать кнопку
// добавления даже без данных.
//
// Имя экспорта осталось прежним, чтобы не переписывать импорты в девяти
// блоках; MMKV-ключи open-state больше не нужны и не читаются.

import type { ReactNode } from "react";
import { Text, View } from "react-native";
import type { BlockKind } from "@babun/shared/local/business-blocks";
import { Card } from "@/components/ui/Card";
import { useThemeColors } from "@/theme/colors";

interface ProfileSectionProps {
  /** Заголовок секции — рисуется caps-надписью над карточкой. */
  title: string;
  /** Короткая сводка справа в строке заголовка («8 · был 10 мая»). */
  summary?: string;
  /** danger → красная сводка, muted → приглушённая. */
  tone?: "default" | "danger" | "muted";
  /** Нет данных → не рисовать секцию совсем. Не ставить блокам,
   *  которые сами являются формой ввода. */
  hideWhenEmpty?: boolean;
  /** Признак пустоты от блока. Если не передан — берём `!summary`. */
  empty?: boolean;
  /** Больше не используется (open-state ушёл вместе со сворачиванием).
   *  Оставлен в сигнатуре, чтобы не трогать девять вызовов разом. */
  kind?: BlockKind;
  /** Больше не используется — секции всегда раскрыты. */
  defaultOpen?: boolean;
  children: ReactNode;
}

export function CollapsibleCard({
  title,
  summary,
  tone = "default",
  hideWhenEmpty = false,
  empty,
  children,
}: ProfileSectionProps) {
  const t = useThemeColors();
  const isEmpty = empty ?? !summary;
  if (hideWhenEmpty && isEmpty) return null;

  const summaryColor =
    tone === "danger" ? t.warning : tone === "muted" ? t.sub : t.ink;

  return (
    <View className="mt-3">
      <View className="flex-row items-end justify-between px-7 pb-2">
        <Text
          className="text-[11px] font-bold uppercase"
          style={{ color: "rgba(11,18,32,0.48)", letterSpacing: 1.4 }}
        >
          {title}
        </Text>
        {summary ? (
          <Text
            className="ml-3 shrink text-[13px] tabular-nums"
            style={{ color: summaryColor }}
            numberOfLines={1}
          >
            {summary}
          </Text>
        ) : null}
      </View>
      <Card style={{ marginHorizontal: 12 }}>
        <View className="px-3 py-2">{children}</View>
      </Card>
    </View>
  );
}
