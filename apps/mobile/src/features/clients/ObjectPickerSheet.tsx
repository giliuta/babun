import { useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { House, Tag } from "lucide-react-native";
import type { Location } from "@babun/shared/local/clients";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { FOOTER_SIDE } from "@/components/ui/tokens";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  SELECT_SHEET_RATIO,
  SelectList,
  SelectRow,
  SelectSearch,
} from "@/components/ui/select-rows";
import { iconPreset } from "@/components/ui/icon-set";
import { addressLines } from "@/features/clients/object-address";
import { findObjectType } from "@/features/clients/object-types";
import { useLocationLabels } from "@/features/settings/local-settings";

// ВЫБОР ОБЪЕКТА ДЛЯ ЗАПИСИ — лист, как выбор клиента: тап на объект
// открывает замену объекта, а внизу — «Добавить объект».
//
// Диалект — `ClientPickerSheet`: строка 52pt на подложке, кружок 28pt слева,
// галка у выбранного, тап выбирает и закрывает. У клиента объектов два-три,
// и поиска нет; событие без клиента получает объекты ВСЕЙ компании — там их
// сотни, и поиск появляется, как только строк больше десятка (канон 5.2).
// Основной — первым, как на карточке: порядок и есть признак основного.
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
  onSelect,
  onDeselect,
  onAdd,
  onClose,
}: {
  visible: boolean;
  locations: readonly Location[];
  selectedId: string | null;
  onSelect: (location: Location) => void;
  /** Повторный тап по выбранному снимает выбор. */
  onDeselect?: () => void;
  /** Открыть лист добавления объекта — после того, как этот уедет. */
  /** Нет — кнопки «Добавить объект» нет: отсюда карточку клиента не
   *  поправить (мастер вне своей базы). */
  onAdd?: () => void;
  onClose: () => void;
}) {
  const afterExit = useRef<(() => void) | null>(null);
  // Типы компании целиком: событие выбирает объекты разных команд.
  const { data: labelPresets = [] } = useLocationLabels(null);
  const ordered = useMemo(
    () =>
      [...locations].sort(
        (a, b) => Number(!!b.isPrimary) - Number(!!a.isPrimary),
      ),
    [locations],
  );
  const [q, setQ] = useState("");
  const searchable = ordered.length > 10;
  const needle = q.trim().toLowerCase();
  const shown = useMemo(
    () =>
      !searchable || !needle
        ? ordered
        : ordered.filter((loc) =>
            [loc.address, loc.label, loc.note]
              .some((v) => (v ?? "").toLowerCase().includes(needle)),
          ),
    [ordered, searchable, needle],
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
        onAdd ? (
          <View style={{ paddingHorizontal: FOOTER_SIDE }}>
            <Button
              label="Добавить объект"
              onPress={() => {
                afterExit.current = onAdd;
                onClose();
              }}
              accessibilityHint="Открывает добавление объекта"
            />
          </View>
        ) : undefined
      }
    >
      {searchable ? (
        <SelectSearch
          value={q}
          onChange={setQ}
          placeholder="Поиск"
          accessibilityLabel="Поиск"
          onClear={() => setQ("")}
        />
      ) : null}
      {shown.length === 0 ? <EmptyState title="Ничего не найдено" /> : null}
      <SelectList>
        {shown.map((loc) => {
          // КАК СТРОКА ОБЪЕКТА: в заголовке адрес, под ним тип словом
          // и точный адрес; плитка — вид типа, без типа — домик. Тип — только
          // заведённый в справочнике: метка удалённого типа объект не красит.
          const type = findObjectType(labelPresets, loc.label);
          const lines = addressLines(loc);
          const title = lines.main || "Адрес не указан";
          const subtitle = [type?.name, lines.detail].filter(Boolean).join(" · ");
          const chosen = loc.id === selectedId;
          return (
            <SelectRow
              key={loc.id}
              icon={type ? (iconPreset(type.icon) ?? Tag) : House}
              color={type?.color ?? undefined}
              title={title}
              subtitle={subtitle || undefined}
              selected={chosen}
              accessibilityLabel={[title, subtitle].filter(Boolean).join(", ")}
              onPress={() => {
                if (onDeselect && chosen) onDeselect();
                else onSelect(loc);
                onClose();
              }}
            />
          );
        })}
      </SelectList>
    </BottomSheet>
  );
}
