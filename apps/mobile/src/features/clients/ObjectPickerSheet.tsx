import { useMemo, useRef } from "react";
import { View } from "react-native";
import { MapPin } from "lucide-react-native";
import type { Location } from "@babun/shared/local/clients";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { GUTTER } from "@/components/ui/tokens";
import {
  SELECT_SHEET_RATIO,
  SelectList,
  SelectRow,
} from "@/components/ui/select-rows";
import { objectTarget } from "@/features/clients/object-address";

// ВЫБОР ОБЪЕКТА ДЛЯ ЗАПИСИ — лист, как выбор клиента (владелец 2026-09-03:
// «мы тапаем на клиента — открывается выбор клиента; то же самое объект:
// тапаем на объект — идёт замена объекта, и внизу вылазит „Добавить
// объект“»).
//
// Диалект — `ClientPickerSheet`: строка 52pt на подложке, кружок 28pt слева,
// галка у выбранного, тап выбирает и закрывает. Поиска нет: объектов у
// клиента два-три, и список виден целиком. Основной — первым, как на
// карточке: порядок и есть признак основного.
//
// «ДОБАВИТЬ ОБЪЕКТ» — ЕДИНСТВЕННАЯ КНОПКА ЛИСТА, в `footer`: то самое
// действие, ради которого сюда идут, когда нужного объекта нет. Открывает
// канонический лист добавления (`ObjectSheet`) — но только когда окно этого
// листа СНЯТО (`onExited`): два листа в один кадр на iOS не показываются.
//
// Хаптика выбора живёт у получателя (`pickLocation`), здесь её нет — иначе
// один тап отдавал два тика.

/** Боковое поле строк и кнопки — одно на лист (закон одного хозяина
 *  отступа): лист `padded={false}`, и футер сам полей не платит. */

export function ObjectPickerSheet({
  visible,
  locations,
  selectedId,
  ownerNameFor,
  onSelect,
  onAdd,
  onClose,
}: {
  visible: boolean;
  locations: readonly Location[];
  selectedId: string | null;
  /** Чей объект — третьей строкой. Событие выбирает объект БЕЗ клиента
   *  (владелец 2026-09-08), и без имени владельца три «Дома» подряд
   *  неразличимы. У записи клиент уже выбран — там подписи нет. */
  ownerNameFor?: (location: Location) => string | null;
  onSelect: (location: Location) => void;
  /** Открыть лист добавления объекта — после того, как этот уедет. */
  onAdd: () => void;
  onClose: () => void;
}) {
  const afterExit = useRef<(() => void) | null>(null);
  const ordered = useMemo(
    () =>
      [...locations].sort(
        (a, b) => Number(!!b.isPrimary) - Number(!!a.isPrimary),
      ),
    [locations],
  );
  return (
    <BottomSheet
      padded={false}
      visible={visible}
      onClose={onClose}
      title="Объект"
      maxHeightRatio={SELECT_SHEET_RATIO}
      scroll
      onExited={() => {
        const run = afterExit.current;
        afterExit.current = null;
        run?.();
      }}
      footer={
        <View style={{ paddingHorizontal: GUTTER }}>
          <Button
            label="Добавить объект"
            onPress={() => {
              afterExit.current = onAdd;
              onClose();
            }}
            accessibilityHint="Открывает добавление объекта"
          />
        </View>
      }
    >
      <SelectList>
        {ordered.map((loc) => {
          const label = loc.label || "Объект";
          const target = objectTarget(loc);
          const owner = ownerNameFor?.(loc) ?? null;
          const chosen = loc.id === selectedId;
          return (
            <SelectRow
              key={loc.id}
              icon={MapPin}
              title={label}
              subtitle={target || "адрес не указан"}
              hint={owner || undefined}
              selected={chosen}
              accessibilityLabel={[label, target, owner].filter(Boolean).join(", ")}
              onPress={() => {
                onSelect(loc);
                onClose();
              }}
            />
          );
        })}
      </SelectList>
    </BottomSheet>
  );
}
