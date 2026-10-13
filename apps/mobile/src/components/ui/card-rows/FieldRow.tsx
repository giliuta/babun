import type { FieldRowProps } from "./field-row-props";
import { renderFieldRowColumn } from "./FieldRowColumn";
import { renderFieldRowInline } from "./FieldRowInline";
import { renderFieldRowStacked } from "./FieldRowStacked";
import { useFieldRow, type FieldRowView } from "./use-field-row";

export type { FieldRowProps } from "./field-row-props";

/** Строка-факт: ярлык · значение · опциональный хвост. Тап по значению
 *  открывает правку на месте (сохранение по blur, как в остальной
 *  карточке). `live` — режим черновика: пишем на каждый символ, потому что
 *  «Готово» читает черновик из текущего замыкания и blur не успел бы. */
export function FieldRow(props: FieldRowProps) {
  const state = useFieldRow(props);
  const view: FieldRowView = { ...props, ...state };
  if (props.column !== undefined) return renderFieldRowColumn(view, props.column);
  if (props.stacked) return renderFieldRowStacked(view);
  return renderFieldRowInline(view);
}
