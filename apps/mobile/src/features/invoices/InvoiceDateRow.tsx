import { useState } from "react";
import { DateWheelSheet } from "@/components/ui/DateWheelSheet";
import { ValueRow } from "@/components/ui/ValueRow";
import { formatShortDateRu } from "@/features/clients/format";
import { todayYmd } from "./format";

// ДАТА ДОКУМЕНТА — БАРАБАНОМ, КАК ВСЁ ВРЕМЯ И ВСЕ ДАТЫ В ПРОДУКТЕ
// (владелец 2026-09-10: «барабан везде»).
//
// История этой строки — про то, как канон догонял сам себя. Сперва здесь был
// свой модал с барабаном и кнопкой «Выбрать дату» — три тапа и отдельное окно
// ради одного числа. Потом (владелец 2026-08-15) её свели с листом операции,
// где дата стояла компактным нативным пикером прямо в строке: «одно движение
// на весь продукт». Движение и правда стало одним, но пикером в строке —
// а он не открывает лист, он дорисовывает второй крошечный контрол у правого
// края, в который надо попасть вторым тапом.
//
// Теперь операция и документ снова сведены — но на канонический
// `DateWheelSheet`: строка-дверь со значением справа, лист снизу с барабаном,
// «Применить». Тот же диалект, что у «Своего периода» финансов.
//
// Ловушка «1 янв. 1970» вместе с нативным пикером ушла: барабан живёт в листе
// и рождается со значением при каждом открытии, а не один раз при монтаже.
export function InvoiceDateRow({
  label,
  value,
  optional,
  minimum,
  separated,
  onChange,
}: {
  label: string;
  /** null — срок не поставлен. Бывает только у `optional`. */
  value: string | null;
  /** Срок можно снять вовсе: инвойс без срока оплаты — обычное дело. */
  optional?: boolean;
  /** Нижняя граница (для «Оплатить до» — день выставления). */
  minimum?: string;
  /** Шов сверху, когда строка стоит не первой в группе. */
  separated?: boolean;
  onChange: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ValueRow
        label={label}
        value={value ? formatShortDateRu(value) : "не поставлен"}
        muted={!value}
        separated={separated}
        onPress={() => setOpen(true)}
      />
      <DateWheelSheet
        visible={open}
        title={label}
        value={value}
        // Значения ещё нет — начинаем с дня выставления, а не с сегодня:
        // «Оплатить до» раньше выставления не бывает.
        seed={minimum ?? todayYmd()}
        minimumDate={minimum}
        clearLabel={optional && value ? `Убрать ${label.toLowerCase()}` : undefined}
        onApply={(ymd) => {
          onChange(ymd);
          setOpen(false);
        }}
        onClear={
          optional
            ? () => {
                onChange(null);
                setOpen(false);
              }
            : undefined
        }
        onClose={() => setOpen(false)}
      />
    </>
  );
}
