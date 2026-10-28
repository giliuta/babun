import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Pressable, Text, View, type LayoutChangeEvent } from "react-native";
import { useThemeColors } from "@/theme/colors";
import { fillRgba } from "@/components/ui/color-contrast";

// ОДНА СВОДКА — ОДИН ВИД ПЛИТОК. Подпись и сумма не режутся многоточием; не
// поместились рядом — плитка встаёт «подпись сверху, сумма под ней справа».
// Решает сводка целиком, а не каждая плитка сама: иначе на 375pt «Ожидается»
// и «Доход €12 450,75» становились в две строки, а их соседи — нет, и ряды
// шли разной высоты. Помещаются все — все в строку, как было.
type SummaryFit = { stacked: boolean; report: (id: string, fits: boolean) => void };
const SummaryFitContext = createContext<SummaryFit | null>(null);

/** Плитки внутри решают вид вместе: одна не поместилась — в столбик все. */
export function SummaryGroup({ children }: { children: ReactNode }) {
  const [misfits, setMisfits] = useState<ReadonlySet<string>>(() => new Set());
  const report = useCallback((id: string, fits: boolean) => {
    setMisfits((prev) => {
      if (fits !== prev.has(id)) return prev;
      const next = new Set(prev);
      if (fits) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const value = useMemo(() => ({ stacked: misfits.size > 0, report }), [misfits, report]);
  return <SummaryFitContext.Provider value={value}>{children}</SummaryFitContext.Provider>;
}

/** Помещаются ли подпись и сумма рядом — по их собственной ширине. Ширины
 *  меряются в обоих видах одинаково (обе своей шириной, не сжаты), поэтому
 *  смена вида ответа не меняет и не качается. */
function useFit() {
  const group = useContext(SummaryFitContext);
  // Отметка держится за `report` (он постоянный), а не за значение сводки:
  // оно меняется при каждом переключении вида, и снятие отметки на каждой
  // смене качало сводку «столбик — строка — столбик».
  const report = group?.report;
  const id = useId();
  const size = useRef({ room: 0, head: 0, value: 0 });
  const [selfFits, setSelfFits] = useState(true);
  const check = useCallback(() => {
    const { room, head, value } = size.current;
    if (!(room > 0 && head > 0 && value > 0)) return;
    const fits = head + value <= room + 0.5;
    setSelfFits(fits);
    report?.(id, fits);
  }, [report, id]);
  useEffect(() => () => report?.(id, true), [report, id]);
  const measure = (key: "room" | "head" | "value") => (e: LayoutChangeEvent) => {
    size.current[key] = e.nativeEvent.layout.width;
    check();
  };
  return { stacked: group ? group.stacked : !selfFits, measure };
}

/**
 * Переключатель сводки: счета, документы, доход, расход, долги, прибыль —
 * ОДИН объект.
 *
 * Компактно, всё в одном стиле: строки, нарисованные по-своему, глаз читал бы как
 * разные сущности, хотя это один ряд однотипных фильтров.
 *
 * Правило раскраски здесь одно и оно же — правило продукта: ЦВЕТ НЕСЁТ СМЫСЛ,
 * а не украшает. Точка и значение окрашены смыслом строки (зелёный — пришло,
 * красный — ушло, янтарь — ждём, кобальт — наше), ярлык нейтральный, фон белый.
 * Тинт — ровно за ВЫБРАННЫМ состоянием: стоя у половины
 * строк просто так, он ничего бы не значил.
 */
export function SummaryToggle({
  label,
  color,
  value,
  quiet,
  a11yValue,
  active,
  locked = false,
  dimmed = false,
  onPress,
}: {
  /** Серая, но нажимается — закрыто тарифом: тап поднимает плашку. */
  dimmed?: boolean;
  label: string;
  /** Цвет смысла строки: им красится точка, а значение — когда оно не ноль. */
  color: string;
  value: string;
  /** НОЛЬ ТИШЕ ЖИВЫХ ДЕНЕГ — тот же закон, что у строки счёта в списке
   *  (`SettingsRow.valueQuiet`). Пять нулей, набранных в полную силу своими
   *  цветами, превращали сводку в ровный шаблон: глаз обегал зелёное,
   *  красное, янтарное и синее и не находил единственное живое число.
   *  Красный «€0» у расхода вдобавок врал прямо цветом — красное в этом
   *  продукте значит «деньги ушли». Точка при этом остаётся цветной: она
   *  называет строку, а не сумму. */
  quiet?: boolean;
  /** Что значит число, если само по себе оно немое: «3» на плитке документов
   *  это «три документа ждут оплаты», и вслух строка обязана сказать это. */
  a11yValue?: string;
  active: boolean;
  /** ДЕНЕГ ЗА СТРОКОЙ ЭТОМУ ЧЕЛОВЕКУ НЕ ПОКАЗЫВАЮТ (доход
   *  серым, расход серым, долги серым, прибыль серым). Точка, ярлык и
   *  значение — одним серым, строка не нажимается. Цвет смысла здесь соврал
   *  бы: зелёная точка у «Дохода» обещает деньги, которых экран не считал. */
  locked?: boolean;
  onPress: () => void;
}) {
  const t = useThemeColors();
  const { stacked, measure } = useFit();
  return (
    <Pressable
      onPress={onPress}
      disabled={locked}
      accessibilityRole="button"
      accessibilityState={{ expanded: active, disabled: locked }}
      // Закрытая строка не называет сумму вслух: «Доход: €0» прозвучал бы
      // фактом о деньгах, а их здесь просто не показывают.
      accessibilityLabel={`${label}: ${locked ? "нет доступа" : (a11yValue ?? value)}`}
      // Строка 38pt + зазор 6pt между рядами: цель касания добирает до 44
      // за счёт зазора, вид не меняется (тот же приём, что у Chip).
      hitSlop={{ top: 3, bottom: 3 }}
      className="flex-row items-center px-3.5 active:opacity-70"
      style={{
        // РОВНО ПОЛОВИНА РЯДА, А НЕ «СКОЛЬКО ПОПРОСИТ СОДЕРЖИМОЕ». Ширину
        // задаёт сетка, а не длина подписи: иначе «Счета | Документы» едут
        // относительно «Доход | Расход» — на узком экране совпадали, на
        // широком разъезжались на 12pt (замерено на Pro Max,
        // по пикселям: 572 и 646 против 609 и 609 у соседних рядов).
        // Базис нулевой и `minWidth: 0` — длинная подпись ужимается внутри
        // своей половины, а не отбирает место у соседней плитки.
        flexBasis: 0,
        flexGrow: 1,
        flexShrink: 1,
        minWidth: 0,
        minHeight: 38,
        paddingVertical: 6,
        borderRadius: t.radius.card,
        opacity: dimmed ? 0.4 : 1,
        // `1a` — тот же тинт, что у выбранного чипа: 10% цвета читается как
        // подсветка, но не спорит со значением, набранным тем же цветом.
        // Тинта ХВАТАЕТ: цветная рамка была третьей грамматикой выбора на
        // продукт (у Chip — заливка, у оттиск-рядов — углубление материала), и
        // 1.5px контур нигде больше не встречался.
        backgroundColor: active && !locked ? fillRgba(color, 0.1) : t.surface,
        borderCurve: "continuous",
      }}
    >
      {/* Ширина содержимого плитки — мерка «поместились ли рядом». */}
      <View
        onLayout={measure("room")}
        style={{
          flex: 1,
          minWidth: 0,
          flexDirection: stacked ? "column" : "row",
          alignItems: stacked ? "stretch" : "center",
        }}
      >
        <View
          onLayout={measure("head")}
          // В столбике подпись стоит своей шириной, а не тянется на всю
          // плитку: иначе мерка «поместились ли» всегда говорила бы «нет».
          style={{ flexDirection: "row", alignItems: "center", alignSelf: stacked ? "flex-start" : "auto" }}
        >
          <View
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: locked ? t.muted : color }}
          />
          <Text
            numberOfLines={1}
            className="ml-2 text-sm font-semibold"
            style={{ color: locked ? t.muted : t.sub }}
          >
            {label}
          </Text>
        </View>
        {/* Пятизначная прибыль с копейками («€12 450,75») на узком экране не
            влезала рядом с подписью и вылезала за край плитки: сумма в строке
            стоит своей шириной (сводка тогда встаёт в столбик), а в столбике,
            длиннее всей плитки, ужимается до 80 %, а не рвётся. */}
        <Text
          onLayout={measure("value")}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          className={`pl-2 text-[15px] ${quiet || locked ? "font-semibold" : "font-bold"}`}
          style={{
            color: locked ? t.muted : quiet ? t.caption : color,
            fontVariant: ["tabular-nums"],
            ...(stacked
              ? { alignSelf: "flex-end", maxWidth: "100%", flexShrink: 1 }
              : { marginLeft: "auto", flexShrink: 0 }),
          }}
        >
          {value}
        </Text>
      </View>
    </Pressable>
  );
}
