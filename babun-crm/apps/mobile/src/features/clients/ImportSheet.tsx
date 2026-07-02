import { useState } from "react";
import { Alert, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import { FileUp, X } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { parseClientsCsv, type ParsedClientsCsv } from "./csv";
import { useImportClients } from "./queries";

const FIELD_LABEL: Record<string, string> = {
  full_name: "Имя",
  phone: "Телефон",
  city: "Город",
  email: "Email",
  address: "Адрес",
  comment: "Заметка",
};

export function ImportSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const importer = useImportClients();
  const [parsed, setParsed] = useState<ParsedClientsCsv | null>(null);
  const [fileName, setFileName] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setParsed(null);
    setFileName("");
    setProgress(null);
    setError(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const pick = async () => {
    setError(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: [
          "text/csv",
          "text/comma-separated-values",
          "public.comma-separated-values-text",
          "text/plain",
          "*/*",
        ],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      setFileName(asset.name ?? "файл.csv");
      const text = await (await fetch(asset.uri)).text();
      const p = parseClientsCsv(text);
      if (p.mappedFields.length === 0 || p.drafts.length === 0) {
        setError(
          "Не распознаны колонки. Нужен заголовок с «Имя» и/или «Телефон».",
        );
        setParsed(null);
        return;
      }
      setParsed(p);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const runImport = async () => {
    if (!parsed) return;
    try {
      const { created, duplicates } = await importer.mutateAsync({
        drafts: parsed.drafts,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      Alert.alert(
        "Готово",
        `Импортировано клиентов: ${created}` +
          (duplicates > 0
            ? `\nПропущено дубликатов по телефону: ${duplicates}`
            : ""),
      );
      close();
    } catch (e) {
      setError((e as Error).message);
      setProgress(null);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable className="flex-1" style={{ backgroundColor: t.scrim }} onPress={close} />
      <View
        className="absolute bottom-0 left-0 right-0 max-h-[80%] rounded-t-3xl p-5"
        style={{
          backgroundColor: t.surface,
          // Bottom-pinned sheet → add the home-indicator inset explicitly.
          paddingBottom: Math.max(32, insets.bottom + 12),
        }}
      >
        <View className="mb-2 flex-row items-center">
          <Text className="flex-1 text-lg font-bold" style={{ color: t.ink }}>
            Импорт клиентов
          </Text>
          <Pressable
            onPress={close}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Закрыть"
          >
            <X color={t.body} size={ICON.md} />
          </Pressable>
        </View>

        {!parsed ? (
          <View>
            <Text className="mb-4 text-sm" style={{ color: t.sub }}>
              CSV-файл с заголовком. Распознаются колонки: Имя, Телефон, Город,
              Email, Адрес, Заметка (русские или английские названия,
              разделитель «,» или «;»).
            </Text>
            {error ? (
              <Text className="mb-3 text-sm" style={{ color: t.danger }}>{error}</Text>
            ) : null}
            <Pressable
              onPress={pick}
              className="flex-row items-center justify-center gap-2 rounded-2xl border border-dashed py-6 active:opacity-60"
              style={{ borderColor: t.separator }}
            >
              <FileUp color={t.accent} size={ICON.md} />
              <Text className="text-base font-semibold" style={{ color: t.accent }}>
                Выбрать CSV-файл
              </Text>
            </Pressable>
          </View>
        ) : (
          <View>
            <Text className="text-sm" style={{ color: t.sub }} numberOfLines={1}>
              {fileName}
            </Text>
            <Text className="mt-1 text-2xl font-bold" style={{ color: t.ink }}>
              {parsed.drafts.length} клиентов
            </Text>
            <View className="mt-2 flex-row flex-wrap gap-2">
              {parsed.mappedFields.map((f) => (
                <Text
                  key={f}
                  className="rounded-full px-2.5 py-1 text-xs font-medium"
                  style={{ backgroundColor: t.fill, color: t.accent }}
                >
                  {FIELD_LABEL[f] ?? f}
                </Text>
              ))}
            </View>
            {parsed.skipped > 0 ? (
              <Text className="mt-2 text-xs" style={{ color: t.faint }}>
                Пропущено пустых строк: {parsed.skipped}
              </Text>
            ) : null}

            <ScrollView className="mt-3 max-h-44 rounded-2xl" style={{ backgroundColor: t.canvas }}>
              {parsed.drafts.slice(0, 20).map((d, i) => (
                <View
                  key={i}
                  className="px-3 py-2"
                  style={{ borderBottomWidth: 1, borderBottomColor: t.separator }}
                >
                  <Text className="text-sm font-medium" style={{ color: t.ink }} numberOfLines={1}>
                    {d.full_name}
                  </Text>
                  {d.phone || d.city ? (
                    <Text className="text-xs" style={{ color: t.sub }} numberOfLines={1}>
                      {[d.phone, d.city].filter(Boolean).join(" · ")}
                    </Text>
                  ) : null}
                </View>
              ))}
              {parsed.drafts.length > 20 ? (
                <Text className="px-3 py-2 text-xs" style={{ color: t.faint }}>
                  …и ещё {parsed.drafts.length - 20}
                </Text>
              ) : null}
            </ScrollView>

            {error ? (
              <Text className="mt-3 text-sm" style={{ color: t.danger }}>{error}</Text>
            ) : null}

            <View className="mt-4">
              <Button
                label={
                  progress
                    ? `Импорт… ${progress.done}/${progress.total}`
                    : `Импортировать ${parsed.drafts.length}`
                }
                onPress={runImport}
                disabled={importer.isPending}
                loading={importer.isPending}
              />
              {!importer.isPending ? (
                <Pressable
                  onPress={() => setParsed(null)}
                  className="mt-1 items-center py-2 active:opacity-60"
                >
                  <Text className="text-sm" style={{ color: t.sub }}>Выбрать другой файл</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}
