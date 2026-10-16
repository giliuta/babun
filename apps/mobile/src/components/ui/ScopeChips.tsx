import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CHIP_GAP, DraggableChipRow } from "@/components/ui/chip-drag";
import { ScrollView, View } from "react-native";
import { Chip } from "@/components/ui/Chip";
import { useThemeColors } from "@/theme/colors";

// ЛЕНТА ОБЛАСТИ ПРОСМОТРА — одна на весь продукт: календарь, финансы, счета.
// Горизонтальная полоса пилюль, которая переключает то, ЧТО показывает экран
// под ней. Выбрана ровно ОДНА КОМАНДА: другую смотрят, переключая чип.
//
// Состояние ровно одно и описано в дизайн-системе: активная команда — заливка
// её цветом. Чипа «Все» нет: сумма всех команд разом — это сводка, и живёт
// она на «Финансах», а не в ленте фильтра.
//
// ТОНИРУЕТСЯ РОВНО ОДИН ЧИП — ВЫБРАННЫЙ. Если красить КАЖДЫЙ чип его цветом
// (обводка + слово), лента станет самым пёстрым местом экрана счетов: красная
// команда означала бы «долг», зелёная — «приход», один пигмент нёс бы два
// несовместимых смысла в одном вьюпорте. Плюс выбранность держалась бы на
// самом тихом признаке (заливка против обводки), а обводка #32ADE6 на белом
// даёт 2.54:1 — ниже порога 3:1 для непечатного элемента. Поэтому покой
// монохромен, выбор — заливка цветом команды. Точки 6pt нет: она меняла бы
// ширину пилюли при выборе.
//
// Родом из TeamChips календаря (web-parity TeamTabStrip).

export type ScopeChip = {
  id: string;
  name: string;
  color?: string | null;
};
// КОМАНДЫ ПАРТНЁРА ВЫГЛЯДЯТ КАК СВОИ: ничем не отличаются ни в финансах, ни в
// календаре. Обводки у чужих чипов нет: у всех один вид, разница только
// «выбран / нет».

/** Левый и правый отступ ленты (компактно). */
const STRIP_PAD = 12;

export function ScopeChips({
  items,
  activeId,
  seam = true,
  onCanvas = false,
  trailing,
  onSelect,
  onReorder,
}: {
  items: ScopeChip[];
  /** `null` — справочник ещё не приехал и выбирать нечего. */
  activeId: string | null;
  /** Шов под лентой. Гасится, когда под ней сразу идёт своя граница —
   *  две линии подряд читаются как случайный зазор. */
  seam?: boolean;
  /** ПРИКОЛОТОЕ ДЕЙСТВИЕ СПРАВА ОТ ЛЕНТЫ — не чип, а кнопка.
   *
   *  Живёт СНАРУЖИ прокрутки и потому не уезжает за край. Внутри ленты она
   *  пряталась бы ровно от того, у кого календарей много: при трёх средних
   *  именах лента занимает ~450pt на экране 402, а автоскролл подводит её к
   *  ВЫБРАННОМУ чипу, не к последнему.
   *
   *  И это не второй тонированный чип: закон «тонируется ровно один чип —
   *  выбранный» цел, потому что в ленту она не входит вовсе. */
  trailing?: ReactNode;
  /** Лента лежит НА КАНВЕ, а не в белом хроме шапки: своей заливки и своего
   *  шва у неё тогда нет вовсе — шов остаётся за шапкой сверху.
   *
   *  Нужно там, где шапка сама стоит на канве (экран счетов): белая полоса
   *  под серой шапкой читается как вторая, лишняя панель. Там, где шапка
   *  белая (календарь), лента остаётся её продолжением — иначе между двумя
   *  белыми полосами появляется серый разрыв. */
  onCanvas?: boolean;
  onSelect: (id: string) => void;
  /** Новый порядок ленты: чип зажимают и перетаскивают (шестерёнка
   *  календаря). Без него лента не перетаскивается. */
  onReorder?: (ids: string[]) => void;
}) {
  const t = useThemeColors();
  const scrollRef = useRef<ScrollView>(null);
  // Пока чип тянут, лента не листается, а отпущенный палец не «тапает» чип.
  const [dragging, setDragging] = useState(false);
  const justDragged = useRef(false);
  const onDragging = (on: boolean) => {
    setDragging(on);
    if (on) justDragged.current = true;
    else setTimeout(() => (justDragged.current = false), 250);
  };

  // Левый край каждого чипа в координатах ленты + к какому чипу лента уже
  // подведена. БЕЗ второго ref повторный layout (поворот, дозагрузка команд)
  // дёргал бы ленту обратно посреди ручной прокрутки.
  const offsets = useRef(new Map<string, number>());
  const shown = useRef<string | null>(null);

  const reveal = useCallback((key: string, animated: boolean) => {
    const x = offsets.current.get(key);
    if (x === undefined || shown.current === key) return;
    shown.current = key;
    scrollRef.current?.scrollTo({ x: Math.max(0, x - 16), animated });
  }, []);

  // Подводим ленту к выбранному чипу НА КАЖДОЕ изменение выбора. Раньше это
  // делалось один раз по onLayout и расходовалось на первом кадре: выбранная
  // команда, доехавшая позже (персист, смена фильтра), оставалась за правым
  // краем — на живом экране чип был обрезан посреди слова.
  useEffect(() => {
    if (activeId) reveal(activeId, true);
  }, [activeId, reveal]);

  // Пустую ленту не рисуем — но ТОЛЬКО если в ней нечему быть. С приколотым
  // действием она остаётся: иначе ровно в состоянии «календарей ещё нет»
  // пропадала бы единственная дверь создания.
  if (items.length === 0 && !trailing) return null;

  const chip = (key: string, node: ReactNode) => (
    <View
      key={key}
      onLayout={(e) => {
        offsets.current.set(key, e.nativeEvent.layout.x);
        // Первый кадр: позиции появляются ПОСЛЕ эффекта выше, поэтому доводим
        // здесь — и без анимации, экран только открылся.
        if (key === activeId) reveal(key, false);
      }}
    >
      {node}
    </View>
  );

  const renderChip = (item: ScopeChip) => (
    <Chip
      label={item.name}
      variant="scope"
      color={item.color || undefined}
      radio
      selected={activeId === item.id}
      // БЕЗ ТОЧКИ ЦВЕТА. Точка то появлялась бы, то пропадала вместе с выбором,
      // и пилюля меняла бы ширину — соседи ездили бы по ленте. Цвет команды
      // несёт только заливка выбранного чипа; покой — одинаково серый.
      onPress={() => {
        if (justDragged.current) return;
        onSelect(item.id);
      }}
      // КОМПАКТНО: ниже и уже обычной пилюли, длинное имя — в одну строку с
      // многоточием.
      numberOfLines={1}
      style={{ maxWidth: 112, minHeight: 28, paddingHorizontal: 7 }}
    />
  );

  const strip = (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      scrollEnabled={!dragging}
      style={{
        flexGrow: 0,
        // С приколотым действием фон и шов несёт обёртка: иначе линия
        // обрывается под кнопкой и та читается вырезанной из полосы.
        backgroundColor: trailing || onCanvas ? "transparent" : t.surface,
        borderBottomWidth: !trailing && !onCanvas && seam ? 1 : 0,
        borderBottomColor: t.separator,
      }}
      contentContainerStyle={{
        // 20, а не гуттер 16: у пилюли скруглённый бок, и на общем отступе она
        // оптически «падает» за край — прямая кромка карточки под ней стоит
        // ровно, а круглая просит воздуха.
        paddingLeft: STRIP_PAD,
        // Справа больше: у последнего чипа не должно быть ощущения, что он
        // упёрся в край и лента кончилась.
        paddingRight: STRIP_PAD,
        paddingVertical: 6,
        gap: CHIP_GAP,
        alignItems: "center",
      }}
    >
      {onReorder ? (
        // ЗАЖАТЬ И ПЕРЕТАЩИТЬ (шестерёнка календаря): места чипов считает
        // поток анимации (`chip-drag.tsx`), поэтому отпускание не прыгает.
        <DraggableChipRow
          ids={items.map((item) => item.id)}
          pad={0}
          onReorder={onReorder}
          onDragging={onDragging}
          onPositions={(x) => {
            // Края — от начала ленты: её левый отступ STRIP_PAD.
            for (const [id, left] of Object.entries(x)) offsets.current.set(id, left + STRIP_PAD);
            if (activeId && x[activeId] != null) reveal(activeId, false);
          }}
          renderChip={(id) => {
            const item = items.find((it) => it.id === id);
            return item ? renderChip(item) : null;
          }}
        />
      ) : (
        items.map((item) => chip(item.id, renderChip(item)))
      )}
    </ScrollView>
  );

  if (!trailing) return strip;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: onCanvas ? "transparent" : t.surface,
        borderBottomWidth: !onCanvas && seam ? 1 : 0,
        borderBottomColor: t.separator,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>{strip}</View>
      {/* Волосяная черта отделяет ленту от действия: без неё кнопка читается
          последним чипом, который почему-то не выбирается. */}
      <View
        style={{ width: 1, height: 20, backgroundColor: t.separator }}
      />
      <View style={{ paddingLeft: 10, paddingRight: 14 }}>{trailing}</View>
    </View>
  );
}
