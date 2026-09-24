import { Text, View } from "react-native";
import type { Client } from "@babun/shared/local/clients";
import { NavRow } from "@/components/ui/card-rows";
import { useThemeColors } from "@/theme/colors";

// «ПОХОЖЕ, ТАКОЙ УЖЕ ЕСТЬ» — подсказка под номером черновика.
//
// ВНУТРИ СОДЕРЖИМОГО КНОПОК НЕТ (владелец 2026-09-15: пустые состояния и
// панели — только слова). Синяя кнопка «Открыть»/«Выбрать» стояла посреди
// блока «Клиент» и была вторым акцентом страницы рядом с единственным
// действием экрана в футере. Дверь к дублю осталась ровно та же, но говорит
// языком остальных строк карточки: имя · телефон · шеврон.

interface ClientDraftNoticeProps {
  duplicate: Client | null;
  error: string | null;
  onOpenDuplicate: (id: string) => void;
  /** Что случится по строке дубля. На карточке — «Открыть» его; из записи —
   *  «Выбрать» его в запись (карточку там не открывают). Слово больше не
   *  пишется на кнопке — кнопки нет, — но остаётся в тексте: иначе из записи
   *  строка обещала бы уход со страницы вместо выбора. */
  openLabel?: string;
}

export function ClientDraftNotice({
  duplicate,
  error,
  onOpenDuplicate,
  openLabel = "Открыть",
}: ClientDraftNoticeProps) {
  const t = useThemeColors();
  if (!duplicate && !error) return null;
  // «Открыть» → «Откройте», «Выбрать» → «Выберите». Два известных слова, а не
  // разбор русского: неизвестное слово честно падает в «Откройте».
  const verb = openLabel === "Выбрать" ? "Выберите" : "Откройте";
  // Безымянный дубль называет себя номером — и тогда номер не повторяется
  // справа: строка «+357 99 12 34 56 — +357 99 12 34 56» выглядит поломкой.
  const dupName = duplicate ? duplicate.full_name.trim() : "";
  const dupLine = duplicate
    ? [dupName ? duplicate.phone : null, duplicate.city].filter(Boolean).join(" · ")
    : "";
  return (
    <View
      className="mt-2 border-t pt-2.5"
      // Отступы СВОИ: слот в карточке пуст, пока подсказки нет, и обёртка с
      // отступами оставляла бы под номером пустую полосу. Горизонтальный
      // отступ живёт на СЛОВАХ, а не на всём блоке: `NavRow` несёт свои 16pt
      // сам, и общий паддинг сдвинул бы строку на 32pt от края.
      style={{ borderColor: t.separator, paddingBottom: 8 }}
      accessibilityRole="alert"
    >
      {duplicate ? (
        <>
          <Text
            className="px-4 pb-1.5 text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: t.sub }}
          >
            Похоже, такой уже есть
          </Text>
          <NavRow
            label={dupName || duplicate.phone || "Клиент"}
            value={dupLine}
            onPress={() => onOpenDuplicate(duplicate.id)}
          />
          {/* Подпись врала: она обещала, что повторное «Готово» создаст
              второго клиента, тогда как владелец это правило ОТМЕНИЛ (два
              клиента на одном номере невозможны) и save() при найденном
              дубле просто ничего не делает. Говорим, как есть. */}
          <Text className="px-4 pt-2 text-[11px]" style={{ color: t.faint }}>
            {`Сохранить нельзя: номер занят. ${verb} существующего клиента или измените номер.`}
          </Text>
        </>
      ) : null}
      {error ? (
        <Text
          className={`px-4 text-sm ${duplicate ? "pt-2" : ""}`}
          style={{ color: t.danger }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}
