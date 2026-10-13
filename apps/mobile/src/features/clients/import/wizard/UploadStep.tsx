import { Pressable, Text, View } from "react-native";
import { FileUp } from "lucide-react-native";
import type { useThemeColors } from "@/theme/colors";
import { ErrorNote } from "./ErrorNote";

export function UploadStep({
  t,
  error,
  onPick,
}: {
  t: ReturnType<typeof useThemeColors>;
  error: string | null;
  onPick: () => void;
}) {
  return (
    <View className="gap-4">
      <Text className="text-sm leading-snug" style={{ color: t.sub }}>
        CSV-файл с заголовком. Распознаются колонки: Имя, Телефон, Город, Email,
        Адрес, Заметка (русские или английские названия, разделитель «,» или
        «;»). Кириллица — в кодировке UTF-8.
      </Text>
      <Pressable
        onPress={onPick}
        accessibilityRole="button"
        accessibilityLabel="Выбрать CSV-файл"
        className="items-center justify-center gap-2 rounded-[10px] border border-dashed py-8 active:opacity-60"
        style={{ borderColor: t.separator, backgroundColor: t.surface }}
      >
        <FileUp color={t.accent} size={32} />
        <Text className="text-base font-semibold" style={{ color: t.accent }}>
          Выбрать CSV-файл
        </Text>
        <Text className="text-xs" style={{ color: t.faint }}>
          До 5000 строк за раз
        </Text>
      </Pressable>
      {error ? <ErrorNote t={t} text={error} /> : null}
    </View>
  );
}
