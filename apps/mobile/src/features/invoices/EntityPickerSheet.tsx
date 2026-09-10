import { useMemo, useState } from "react";
import { ScrollView } from "react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import {
  SELECT_SHEET_RATIO,
  SelectSearch,
} from "@/components/ui/select-rows";
import { ValueOptionList } from "@/components/ui/ValuePickerSheet";

// ВЫБОР КЛИЕНТА / ЗАЯВКИ / КОМАНДЫ В РЕДАКТОРЕ ИНВОЙСА.
//
// Тот же жанр, что ValuePickerSheet («один из длинного списка»), плюс поле
// поиска: клиентов бывают сотни, и без поиска лист превращается в прокрутку
// вслепую. Строки — общий ValueOptionList: закон «один дизайн на все списки»
// запрещает собственную вёрстку строки, а лист — только канонический
// BottomSheet (раньше здесь был полноэкранный Modal slide со своей шапкой).

export interface EntityOption {
  id: string;
  title: string;
  subtitle?: string;
}

/** «Не выбрано» — легальное значение (инвойс без заявки), поэтому оно живёт
 *  строкой списка, а не повторным тапом по выбранному. */
const NONE_ID = "__none__";

export function EntityPickerSheet({
  visible,
  title,
  options,
  selectedId,
  allowEmpty = true,
  onPick,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: EntityOption[];
  selectedId: string | null;
  allowEmpty?: boolean;
  onPick: (id: string | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru");
    if (!needle) return options;
    return options.filter((option) =>
      `${option.title} ${option.subtitle ?? ""}`.toLocaleLowerCase("ru").includes(needle),
    );
  }, [options, query]);

  const rows = useMemo(
    () => [
      // «Не выбрано» не фильтруется поиском: дорога «отвязать» доступна всегда.
      ...(allowEmpty ? [{ id: NONE_ID, label: "Не выбрано" }] : []),
      ...filtered.map((option) => ({
        id: option.id,
        label: option.title,
        hint: option.subtitle,
      })),
    ],
    [allowEmpty, filtered],
  );

  const close = () => {
    setQuery("");
    onClose();
  };
  const pick = (id: string | null) => {
    onPick(id === NONE_ID ? null : id);
    close();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      title={title}
      maxHeightRatio={SELECT_SHEET_RATIO}
      avoidKeyboard
    >
      {/* ПОИСК — ОБЩИЙ (2026-09-10). Здесь стояло своё второе поле: высота
          44 вместо 40, кегль 16 вместо 15, отступ 12 вместо GUTTER и без
          кнопки очистки. Одно и то же поле поиска в продукте жило тремя
          копиями. */}
      <SelectSearch
        value={query}
        onChange={setQuery}
        placeholder="Поиск"
        accessibilityLabel={`Поиск: ${title}`}
        onClear={() => setQuery("")}
      />
      <ScrollView
        style={{ flexShrink: 1 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 20 }}
      >
        <ValueOptionList
          options={rows}
          selectedId={selectedId ?? (allowEmpty ? NONE_ID : null)}
          emptyLabel="Ничего не найдено"
          // Повторный тап по выбранному не «снимает» его: за пустоту отвечает
          // строка «Не выбрано», а не побочный эффект.
          clearable={false}
          onPick={pick}
        />
      </ScrollView>
    </BottomSheet>
  );
}
