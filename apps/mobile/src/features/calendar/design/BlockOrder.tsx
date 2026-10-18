import type { ReactNode } from "react";
import { View } from "react-native";
import { ReorderList } from "@/components/ui/ReorderList";

/** Подвижные блоки формы: строки с ручкой справа — тянут за неё, тап по
 *  строке по-прежнему включает и выключает блок. Без права «Записи» — те же
 *  строки в том же порядке, без ручек. */
export function BlockOrder({
  ids,
  readOnly,
  labelFor,
  onReorder,
  onDraggingChange,
  cell,
}: {
  ids: readonly string[];
  readOnly: boolean;
  labelFor: (id: string) => string;
  onReorder: (ids: string[]) => void;
  onDraggingChange: (dragging: boolean) => void;
  cell: (id: string) => ReactNode;
}) {
  if (readOnly) return <>{ids.map((id) => <View key={id}>{cell(id)}</View>)}</>;
  return (
    <ReorderList
      items={ids.map((id) => ({ id }))}
      rowHeight={44}
      divided={false}
      labelFor={(item) => labelFor(item.id)}
      onReorder={onReorder}
      onDraggingChange={onDraggingChange}
    >
      {(item) => cell(item.id)}
    </ReorderList>
  );
}
