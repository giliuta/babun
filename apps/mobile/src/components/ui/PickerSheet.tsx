import { useEffect, useRef } from "react";
import { Pressable } from "react-native";
import { Settings2 } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { BottomSheet, SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import {
  SELECT_SHEET_RATIO,
  SelectList,
  SelectRow,
} from "@/components/ui/select-rows";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// ЛИСТ ВЫБОРА ДЕЙСТВИЯ — «Добавить» на карточке, «Как связаться» у номера
// (владелец 2026-08-02: «запомни этот вид дизайна и используй везде»).
// Строка = цветной значок слева + подпись; тап выбирает и закрывает лист.
//
// ЛИСТ — ЭТО ДЕЙСТВИЕ, А НЕ НАСТРОЙКА. Наборы («Способы связи», «Что можно
// добавить», «Карты для маршрута») живут ПОЛНОЦЕННЫМИ СТРАНИЦАМИ
// (ToggleListScreen) — закон владельца 2026-08-02. Шестерёнка в углу
// заголовка ведёт на страницу своего списка, а не открывает второй лист
// поверх первого.
//
// Язык строки на странице и в листе один и тот же: человек узнаёт список,
// откуда бы он ни пришёл.

export interface PickerSheetItem {
  id: string;
  label: string;
  /** Значок строки: компонент из общего словаря (`icon-set`) либо эмодзи
   *  строкой — категории операций хранят именно его. */
  icon: LucideIcon | string;
  color: string;
  /** Тихая подпись под именем: «30 мин» у типа события. Не украшение —
   *  выбор типа МЕНЯЕТ длительность события, и сказать об этом надо до
   *  нажатия, а не после. */
  hint?: string;
  onPress: () => void;
}

export function PickerSheet({
  visible,
  title,
  subtitle,
  items,
  selectedId,
  onSettings,
  settingsLabel = "Настроить список",
  onClose,
  onExited,
}: {
  visible: boolean;
  title: string;
  /** Тихая строка под заголовком — «пт, 25 сентября, 10:00–10:30» у меню
   *  записи: о чём меню, видно, не глядя на сетку за шторкой. */
  subtitle?: string;
  items: PickerSheetItem[];
  /** Что выбрано сейчас. У выбора «с нуля» (тип события новой записи) его
   *  нет; у правки существующей операции без него не видно, что стоит. */
  selectedId?: string | null;
  /** Значок справа от заголовка — вход на страницу этого списка. */
  onSettings?: () => void;
  settingsLabel?: string;
  onClose: () => void;
  /** Лист ушёл и его окно снято — отсюда можно поднимать СЛЕДУЮЩУЮ шторку
   *  (iOS не показывает вторую модалку, пока первая не ушла). */
  onExited?: () => void;
}) {
  const t = useThemeColors();
  // Выбранный пункт ждёт, пока окно листа снимут (см. `onPress` строки).
  const pendingAction = useRef<(() => void) | null>(null);
  const fallback = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = () => {
    if (fallback.current) clearTimeout(fallback.current);
    fallback.current = null;
    const run = pendingAction.current;
    pendingAction.current = null;
    run?.();
  };
  // СТРАХОВКА: родитель снял лист целиком (условный рендер) — `onExited` уже
  // не придёт, а выбор сделан. Выполняем его после ухода окна, как раньше.
  useEffect(
    () => () => {
      const run = pendingAction.current;
      pendingAction.current = null;
      if (fallback.current) clearTimeout(fallback.current);
      if (run) setTimeout(run, SHEET_EXIT_MS);
    },
    [],
  );
  return (
    <BottomSheet
      padded={false}
      visible={visible}
      onClose={onClose}
      onExited={() => {
        onExited?.();
        flush();
      }}
      // ПОЛЭКРАНА И ПРОКРУТКА ВНУТРИ. Лист задумывался под «что сделать» —
      // пять-шесть строк, которые всегда влезали, — и потому жил без потолка
      // и без `scroll`. Потом им стали выбирать категорию операции: строк
      // пятнадцать, на экран влезает двенадцать, и три последние нельзя было
      // ни увидеть, ни выбрать.
      maxHeightRatio={SELECT_SHEET_RATIO}
      scroll
      // ШАПКА — ОБЩАЯ (2026-09-10). Здесь она была нарисована своей строкой с
      // ручным центрированием заголовка «на ширину шестерёнки»; `BottomSheet`
      // умеет это сам, и умеет одинаково для всех шторок продукта.
      title={title}
      subtitle={subtitle}
      headerAction={
        onSettings ? (
          <Pressable
            onPress={() => {
              haptics.tap();
              onClose();
              onSettings();
            }}
            accessibilityRole="button"
            accessibilityLabel={settingsLabel}
            hitSlop={10}
            style={({ pressed }) => ({
              width: 32,
              height: 32,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.5 : 1,
            })}
          >
            {/* ТОТ ЖЕ ЗНАЧОК, ЧТО В ШАПКАХ ПАНЕЛЕЙ (владелец 2026-08-15:
                «справа поставь эти две палочки с кружочками»; 2026-09-10:
                «не шестерёнка, а вот эти маленькие тумблеры»). Шестерёнка
                в продукте больше нигде не значит «настроить список». */}
            <Settings2 color={t.sub} size={20} strokeWidth={2} />
          </Pressable>
        ) : undefined
      }
    >
      {/* СТРОКА — ОБЩАЯ. Диалект тот же, что у выбора клиента, объекта и
          метки; галки нет по смыслу жанра: это ДЕЙСТВИЕ, а не значение. */}
      <SelectList>
        {items.map((item) => (
          <SelectRow
            key={item.id}
            icon={item.icon}
            color={item.color}
            title={item.label}
            hint={item.hint}
            selected={item.id === selectedId}
            onPress={() => {
              haptics.tap();
              onClose();
              // ДЕЙСТВИЕ ЖДЁТ, ПОКА ЛИСТ УЕДЕТ. Всё, что открывает своё окно
              // поверх (второй лист, вопрос «Удалить?», системный
              // «Поделиться»), поверх уходящего листа iOS не показывает.
              // Раньше ждали таймером SHEET_EXIT_MS (240 мс) — но окно снимают
              // ПОСЛЕ анимации и коммита, и таймер его обгонял: 24.09
              // «Удалить событие» в меню записи не открывало вопроса вовсе.
              // Теперь ждём `onExited` — окно листа уже снято.
              // Страховка на случай, если лист так и не закроют: выбор не
              // теряется, срабатывает через секунду.
              pendingAction.current = item.onPress;
              if (fallback.current) clearTimeout(fallback.current);
              fallback.current = setTimeout(flush, 1000);
            }}
          />
        ))}
      </SelectList>
    </BottomSheet>
  );
}

export default PickerSheet;
