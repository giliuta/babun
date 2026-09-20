import { Pressable, Text, View } from "react-native";
import { Briefcase } from "lucide-react-native";
import { formatEURExact } from "@babun/shared/common/utils/money";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { SectionCard } from "@/components/ui/SectionCard";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import { TotalRow } from "./BookingSummary";
import { QtyBadge } from "./QtyBadge";

// БЛОК «УСЛУГИ» — ОДИН НА ПРОДУКТ.
//
// Жил внутри формы записи (`app/book/index.tsx`) полутора сотнями строк JSX,
// пока его не попросили во второй документ: владелец 2026-09-20 про
// составитель чека — «блок с услугами такой же блок, как в записи, итого
// такой же блок… не надо создавать с нуля что-то новое, копируй то, что мы
// уже создали». Копировать разметку значит завести вторую, которая назавтра
// разойдётся с первой, поэтому блок вынесен СЮДА и зовётся из обоих мест.
//
// Вынос — БЕЗ ЕДИНОЙ ПРАВКИ ВИДА: разметка, отступы, порядок колонок и все
// решения владельца, записанные здесь комментариями, перенесены дословно.
// Изменилось только то, откуда блок берёт данные: вместо переменных экрана
// записи — пропы.
//
// ЧТО БЛОК НЕ ДЕЛАЕТ. Он не знает ни про запись, ни про чек, ни про инвойс:
// не ходит в каталог, не считает деньги (итог приходит числом) и не
// открывает листов сам — только зовёт `onPickServices` и `onOpenTotal`.
//
// СТРОКА — НЕЙТРАЛЬНАЯ, А НЕ «УСЛУГА ЗАПИСИ». У записи вторая строка это
// длительность, у инвойса — описание позиции; поэтому блок принимает уже
// готовый `subtitle`, а перевод «своя сущность → строка блока» делает
// вызывающий. Без этого третий документ пришлось бы кормить услугами записи,
// и позиция инвойса носила бы минуты работ, которых у неё нет.

/** Строка блока — то немногое, что есть у работы записи, позиции чека и
 *  позиции инвойса одинаково. */
export interface ServicesBlockLine {
  id: string;
  name: string;
  /** Вторая строка под именем: длительность у записи, описание у инвойса.
   *  Пусто — строки нет вовсе. */
  subtitle?: string | null;
  qty: number;
  unit?: string | null;
  pricePerUnit: number;
  total: number;
}

export function ServicesBlock({
  title = "Услуги",
  lines,
  emptyLabel = "Выбрать услугу",
  total,
  custom,
  discountAmount,
  onPickServices,
  onOpenTotal,
}: {
  /** Шапка блока: «Услуги» у записи и чека, «Позиции» у инвойса. */
  title?: string;
  lines: readonly ServicesBlockLine[];
  emptyLabel?: string;
  total: number;
  /** Сумму перебили рукой — «Итого» перестало следовать за услугами. */
  custom: boolean;
  discountAmount: number;
  onPickServices: () => void;
  onOpenTotal: () => void;
}) {
  const t = useThemeColors();

  return (
    <SectionCard title={title}>
      {lines.length === 0 ? (
        <>
          {/* ТА ЖЕ ДВЕРЬ, ЧТО У КЛИЕНТА И ОБЪЕКТА (аудит 2026-09-06):
              пустые состояния формы отвечают на один вопрос и выглядят
              одинаково. */}
          <ChooseRow
            icon={Briefcase}
            label={emptyLabel}
            hint="Открывает список услуг"
            onPress={onPickServices}
          />
          <TotalRow
            total={total}
            custom={custom}
            discountAmount={discountAmount}
            onPress={() => {
              onOpenTotal();
              haptics.tap();
            }}
          />
        </>
      ) : (
        <>
          {lines.map((line, index) => (
            <View
              key={line.id}
              // Волосок — МЕЖДУ строками, не под шапкой «УСЛУГИ»: у остальных
              // карточек под надписью линии нет.
              style={{ borderTopWidth: index > 0 ? 1 : 0, borderTopColor: t.separator }}
            >
              {/* ТАП ПО УСЛУГЕ ОТКРЫВАЕТ СПИСОК УСЛУГ ЗАНОВО (владелец
                  2026-09-04: «„Добавить услугу“ убираем; тапаю по выбранной
                  услуге — открывается список»). Та же грамматика, что у
                  клиента и объекта: строка выбранного и есть дверь к выбору. */}
              <Pressable
                className="flex-row items-center px-4 py-2.5"
                onPress={() => {
                  onPickServices();
                  haptics.tap();
                }}
                style={({ pressed }) => ({
                  backgroundColor: pressed ? t.pressed : "transparent",
                })}
                accessibilityRole="button"
                accessibilityLabel={`${line.name}${line.subtitle ? `, ${line.subtitle}` : ""}, ${formatEURExact(line.total)}`}
                accessibilityHint="Открывает выбор услуг"
              >
                {/* ЦВЕТНОЙ ТОЧКИ БОЛЬШЕ НЕТ (владелец 2026-09-08: «убираем
                    полностью цвет — я понял, что он вообще не нужен»). */}
                <View className="flex-1 pr-2">
                  <Text style={{ fontSize: 15, color: t.ink }}>{line.name}</Text>
                  {line.subtitle ? (
                    <Text style={{ fontSize: 13, color: t.placeholder, marginTop: 1 }}>
                      {line.subtitle}
                    </Text>
                  ) : null}
                </View>
                {/* СКОЛЬКО РАЗ ВЗЯЛИ — ОТТИСКОМ «×3» (владелец 2026-09-04,
                    выбрал из четырёх вариантов на экране сравнения). */}
                <QtyBadge qty={line.qty} unit={line.unit ?? null} />
                {/* ЦЕНА ЗА ОДНУ — МЕЛКО, МЕЖДУ КОЛИЧЕСТВОМ И СУММОЙ (владелец
                    2026-09-07: «посередине количество, потом цена за штуку
                    маленькими цифрами, правее общая сумма за услугу»). */}
                <Text
                  style={{
                    fontSize: 12,
                    color: t.sub,
                    minWidth: 44,
                    marginLeft: 8,
                    textAlign: "right",
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {formatEURExact(line.pricePerUnit)}
                </Text>
                <Text
                  style={{
                    fontSize: 15,
                    fontWeight: "600",
                    color: t.ink,
                    minWidth: 56,
                    marginLeft: 8,
                    textAlign: "right",
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {formatEURExact(line.total)}
                </Text>
              </Pressable>
            </View>
          ))}
          {/* ИТОГ — ДВЕРЬ, А НЕ ПОЛЕ (владелец 2026-09-04: «когда я открываю
              „Итого“, открывается шторка, где прописаны каждая услуга,
              количество их, и там же скидки»). Скидка называется прямо в
              строке: видно, почему сумма меньше суммы услуг. */}
          <TotalRow
            total={total}
            custom={custom}
            discountAmount={discountAmount}
            onPress={() => {
              onOpenTotal();
              haptics.tap();
            }}
          />
        </>
      )}
    </SectionCard>
  );
}
