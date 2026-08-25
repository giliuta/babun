import { useMemo, useState } from "react";
import { ScrollView, TextInput, View } from "react-native";
import { Search } from "lucide-react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { ICON } from "@/components/ui/tokens";
import { ValueOptionList } from "@/components/ui/ValuePickerSheet";
import { useThemeColors } from "@/theme/colors";

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
  const t = useThemeColors();
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
      maxHeightRatio={0.9}
      avoidKeyboard
    >
      <View
        style={{
          marginHorizontal: 12,
          marginBottom: 10,
          minHeight: 44,
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 12,
          borderRadius: t.radius.input,
          backgroundColor: t.fill,
        }}
      >
        <Search color={t.faint} size={ICON.sm} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Поиск"
          placeholderTextColor={t.placeholder}
          selectionColor={t.accent}
          keyboardAppearance="light"
          autoCorrect={false}
          accessibilityLabel={`Поиск: ${title}`}
          style={{ marginLeft: 8, flex: 1, fontSize: 16, color: t.ink }}
        />
      </View>
      <ScrollView
        style={{ flexShrink: 1 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 28 }}
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
