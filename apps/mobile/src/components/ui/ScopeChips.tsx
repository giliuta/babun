import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { Chip } from "@/components/ui/Chip";
import { useThemeColors } from "@/theme/colors";

// ЛЕНТА ОБЛАСТИ ПРОСМОТРА — одна на весь продукт: календарь, финансы, счета.
// Горизонтальная полоса пилюль, которая переключает то, ЧТО показывает экран
// под ней. Выбрана ровно ОДНА КОМАНДА — «хочешь посмотреть команду,
// переключайся» (владелец 2026-08-11).
//
// Состояние ровно одно и описано в дизайн-системе: активная команда — заливка
// её цветом. Закреплённый чип «Все» УБРАН 2026-08-11 вместе с последним
// экраном, который его показывал (счета): сумма всех команд разом — это
// сводка, и живёт она на «Финансах», а не в ленте фильтра.
//
// ТОНИРУЕТСЯ РОВНО ОДИН ЧИП — ВЫБРАННЫЙ (2026-08-12). Раньше лента красила
// КАЖДЫЙ чип его цветом (обводка + слово), и на экране счетов она была самым
// пёстрым местом: красная команда означала «долг», зелёная — «приход», один
// пигмент нёс два несовместимых смысла в одном вьюпорте. Плюс выбранность
// держалась на самом тихом признаке (заливка против обводки), а обводка
// #32ADE6 на белом давала 2.54:1 — ниже порога 3:1 для непечатного элемента.
// Теперь: покой монохромен, цвет команды несёт точка 6pt, выбор — заливка.
//
// Родом из TeamChips календаря (web-parity TeamTabStrip).

export type ScopeChip = { id: string; name: string; color?: string | null };

export function ScopeChips({
  items,
  activeId,
  seam = true,
  onCanvas = false,
  trailing,
  onSelect,
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
   *  выбранный» (2026-08-12) цел, потому что в ленту она не входит вовсе. */
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
}) {
  const t = useThemeColors();
  const scrollRef = useRef<ScrollView>(null);
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

  const strip = (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
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
        paddingLeft: 20,
        // Справа больше: у последнего чипа не должно быть ощущения, что он
        // упёрся в край и лента кончилась.
        paddingRight: 24,
        paddingVertical: 10,
        gap: 8,
        alignItems: "center",
      }}
    >
      {items.map((item) => {
        const selected = activeId === item.id;
        return chip(
          item.id,
          <Chip
            label={item.name}
            variant="scope"
            color={item.color || undefined}
            radio
            selected={selected}
            // Точка нужна ТОЛЬКО в покое: у выбранного чипа его цвет уже залит
            // во всю пилюлю, и точка была бы вторым сообщением об одном.
            icon={
              selected ? undefined : (
                <View
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: t.radius.pill,
                    backgroundColor: item.color || t.accent,
                  }}
                />
              )
            }
            onPress={() => onSelect(item.id)}
            style={{ maxWidth: 180 }}
          />,
        );
      })}
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
