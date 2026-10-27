import { Pressable, Text, View } from "react-native";
import type { CountryCode } from "libphonenumber-js";
import { formatCountRu } from "@babun/shared/common/utils/plural-ru";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { useThemeColors } from "@/theme/colors";
import type { ParsedCsv } from "../csv-parse";
import { COUNTRY_OPTIONS, type ImportableField } from "../csv-mapping";
import type { ImportResumeState } from "../resume";
import { ErrorNote } from "./ErrorNote";
import { FieldPicker, TagChip } from "./MappingPickers";
import { withColumn } from "./wizard-rules";

export function MappingStep({
  t,
  parsed,
  mapping,
  setMapping,
  country,
  setCountry,
  tags,
  tagId,
  setTagId,
  hasName,
  resume,
  preparing,
  onResume,
  onDiscardResume,
  onBack,
  onNext,
}: {
  t: ReturnType<typeof useThemeColors>;
  parsed: ParsedCsv;
  mapping: ImportableField[];
  setMapping: (m: ImportableField[]) => void;
  country: CountryCode;
  setCountry: (c: CountryCode) => void;
  tags: { id: string; name: string; color: string }[];
  tagId: string | null;
  setTagId: (id: string | null) => void;
  hasName: boolean;
  resume: ImportResumeState | null;
  preparing: boolean;
  onResume: () => void;
  onDiscardResume: () => void;
  onBack: () => void;
  onNext: () => void;
}) {
  // Keep each non-skip field on at most one column (mirror web / auto-map).
  const setCol = (idx: number, field: ImportableField) =>
    setMapping(withColumn(mapping, idx, field));

  return (
    <View className="gap-4">
      <Text className="text-xs" style={{ color: t.sub }}>
        {formatCountRu(parsed.rows.length, ["строка", "строки", "строк"])} ·{" "}
        {formatCountRu(parsed.headers.length, ["колонка", "колонки", "колонок"])}
      </Text>

      {resume ? (
        <View
          className="gap-2 rounded-[10px] p-4"
          style={{ backgroundColor: "rgba(245,166,35,0.10)" }}
        >
          <Text className="text-[13px] font-semibold" style={{ color: t.warning }}>
            Прошлый импорт не завершён
          </Text>
          <Text className="text-[13px] leading-snug" style={{ color: t.warning }}>
            Импортировано {resume.importedRows} из {resume.totalRows}. Продолжить
            с места обрыва — уже добавленные не задвоятся.
          </Text>
          <View className="mt-1 flex-row gap-2">
            <Pressable
              onPress={onResume}
              disabled={preparing}
              accessibilityRole="button"
              accessibilityLabel="Продолжить прошлый импорт"
              accessibilityState={{ disabled: preparing, busy: preparing }}
              className="min-h-11 items-center justify-center rounded-full px-3 py-1.5 active:opacity-70"
              style={{ backgroundColor: t.warning }}
            >
              <Text className="text-[13px] font-semibold text-white">Продолжить</Text>
            </Pressable>
            <Pressable
              onPress={onDiscardResume}
              disabled={preparing}
              accessibilityRole="button"
              accessibilityLabel="Начать импорт заново"
              accessibilityState={{ disabled: preparing, busy: preparing }}
              className="min-h-11 items-center justify-center rounded-full px-3 py-1.5 active:opacity-70"
              style={{ backgroundColor: t.fill }}
            >
              <Text className="text-[13px] font-semibold" style={{ color: t.body }}>
                Начать заново
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <Card className="p-0">
        {parsed.headers.map((h, idx) => (
          <View
            key={idx}
            className="flex-row items-center gap-3 px-4 py-3"
            style={
              idx < parsed.headers.length - 1
                ? { borderBottomWidth: 1, borderBottomColor: t.separator }
                : undefined
            }
          >
            <View className="flex-1">
              <Text className="text-[13px]" style={{ color: t.faint }}>
                Колонка {idx + 1}
              </Text>
              <Text
                className="text-[15px]"
                style={{ color: t.ink }}
                numberOfLines={1}
              >
                {h || `(без названия)`}
              </Text>
            </View>
            <FieldPicker
              t={t}
              value={mapping[idx] ?? "skip"}
              onChange={(f) => setCol(idx, f)}
            />
          </View>
        ))}
      </Card>

      <View className="gap-2">
        <Text
          className="text-[11px] font-bold uppercase"
          style={{ color: t.faint, letterSpacing: 0.6 }}
        >
          Код страны для телефонов без «+»
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {COUNTRY_OPTIONS.map((c) => {
            const active = country === c.value;
            return (
              <Pressable
                key={c.value}
                onPress={() => setCountry(c.value)}
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
                accessibilityLabel={`Код страны ${c.label}`}
                className="min-h-11 items-center justify-center rounded-full px-3 py-1.5 active:opacity-70"
                style={{
                  backgroundColor: active ? t.accent : t.fill,
                }}
              >
                <Text
                  className="text-[13px] font-semibold"
                  style={{ color: active ? "#fff" : t.body }}
                >
                  {c.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {tags.length > 0 ? (
        <View className="gap-2">
          <Text
            className="text-[11px] font-bold uppercase"
            style={{ color: t.faint, letterSpacing: 0.6 }}
          >
            Тег для всех импортированных
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <TagChip
              t={t}
              label="— нет —"
              active={tagId === null}
              onPress={() => setTagId(null)}
            />
            {tags.map((tag) => (
              <TagChip
                key={tag.id}
                t={t}
                label={tag.name}
                color={tag.color}
                active={tagId === tag.id}
                onPress={() => setTagId(tag.id)}
              />
            ))}
          </View>
        </View>
      ) : null}

      {!hasName ? (
        <ErrorNote
          t={t}
          tone="warning"
          text="Колонка «Имя» обязательна — сопоставьте хотя бы одну (или используйте телефон как имя)."
        />
      ) : null}

      <View className="mt-2 flex-row gap-2">
        <View className="flex-1">
          <Button label="Назад" variant="secondary" onPress={onBack} />
        </View>
        <View className="flex-1">
          <Button
            label={preparing ? "Проверяем…" : "Далее"}
            onPress={onNext}
            disabled={!hasName || preparing}
          />
        </View>
      </View>
    </View>
  );
}
