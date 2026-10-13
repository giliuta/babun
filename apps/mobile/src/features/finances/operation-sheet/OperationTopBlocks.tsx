import type { FinanceCategory } from "@babun/shared/db/repositories/finance-categories";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { GUTTER } from "@/components/ui/tokens";
import { WhenRow } from "@/features/appointments/BookingSummary";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import { CategoryBlock } from "../CategoryBlock";
import type { OperationType } from "./types";

/** The head of the operation form: the side of the money, when, and the
 *  category — in the order the person thinks. */
export function OperationTopBlocks({
  type,
  onTypeChange,
  typeLocked,
  date,
  whenTime,
  onOpenWhen,
  category,
  onOpenCategory,
}: {
  type: OperationType;
  onTypeChange: (next: OperationType) => void;
  typeLocked: boolean;
  date: string;
  /** Time shown in the row: the operation's own or «now». */
  whenTime: string;
  onOpenWhen: () => void;
  category: FinanceCategory | null;
  onOpenCategory: () => void;
}) {
  const th = useThemeColors();
  return (
    <>
      {/* 1. Расход | Доход */}
      <SegmentedControl
        options={[
          { value: "expense", label: "Расход", color: th.danger },
          { value: "income", label: "Доход", color: th.success },
        ]}
        value={type}
        onChange={onTypeChange}
        // У платежа по долгу направление уже решено самим долгом: «мне
        // должны» гасят доходом, «я должен» — расходом. Переключатель здесь
        // только называет сторону. Та же немота, когда человек может
        // завести лишь одну сторону денег: переключать ему некуда.
        disabled={typeLocked}
        style={{ marginHorizontal: GUTTER, marginTop: 12 }}
      />

      {/* 2. КОГДА — ТОТ ЖЕ БЛОК, ЧТО В ЗАПИСИ (владелец 2026-09-09: «посмотри
          по архитектуре, как мы делаем блок время»). Строка «день · время»
          открывает тот же лист с полосой недель и барабанами, каким
          назначают визит. Разница одна: у операции время — МОМЕНТ, а не
          отрезок, поэтому сегмент «Начало | Конец» в листе спрятан.

          Здесь стоял системный пикер iOS внутри строки — чужой продукту
          контрол и второй способ сказать то же самое. */}
      <WhenRow
        date={date}
        timeStart={whenTime}
        onPress={() => {
          onOpenWhen();
          haptics.tap();
        }}
      />

      {/* 3. КАТЕГОРИЯ И 4. СУММА — ТЕ ЖЕ БЛОКИ, ЧТО У ДОЛГА (владелец
          2026-09-10: «операции сделай так же, как долги — блок категории,
          блок сумма, ниже заметка, ниже файл; берёшь то, что уже имеем»).

          Были склеены в одну карточку ради компактности, и от блока
          оставалась строка поля: слово «Категория» слева, серое «Выбрать» в
          хвосте, сумма без подписи. Блок узнают по шапке и границам раньше,
          чем читают, — а компактность взята воздухом, а не слиянием. */}
      <CategoryBlock
        category={category}
        onPress={() => {
          onOpenCategory();
          haptics.tap();
        }}
      />
    </>
  );
}
