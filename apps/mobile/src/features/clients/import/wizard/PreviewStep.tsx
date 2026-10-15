import { Text, View } from "react-native";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { useThemeColors } from "@/theme/colors";
import type { MapAndValidateResult, MappedRow } from "../csv-validate";
import { previewReasonParts, REASON_TONE } from "./wizard-rules";

export function PreviewStep({
  t,
  validation,
  willImport,
  willSkip,
  onBack,
  onConfirm,
}: {
  t: ReturnType<typeof useThemeColors>;
  validation: MapAndValidateResult;
  willImport: number;
  willSkip: number;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const sample: MappedRow[] = validation.mapped.slice(0, 10);
  const parts = previewReasonParts(validation);

  return (
    <View className="gap-4">
      <Card className="p-4">
        <View className="flex-row gap-3">
          <Counter t={t} value={willImport} label="Готово" tone={t.success} />
          <Counter t={t} value={willSkip} label="Пропущено" tone={t.faint} />
          <Counter
            t={t}
            value={validation.duplicateInDb}
            label="Дубликаты"
            tone={t.warning}
          />
        </View>
        {parts.length > 0 ? (
          <Text className="mt-2 text-xs" style={{ color: t.sub }}>
            {parts.join(" · ")}
          </Text>
        ) : null}
      </Card>

      {/* Номер у клиента один: дубль из базы не импортируется, и выбора здесь
          нет — только слова. */}
      {validation.duplicateInDb > 0 ? (
        <Text className="text-xs" style={{ color: t.sub }}>
          Клиенты с номерами, которые уже есть в базе, пропускаются.
        </Text>
      ) : null}

      <Card className="p-0">
        <Text
          className="px-4 pb-1 pt-3 text-[11px] font-bold uppercase"
          style={{ color: t.faint, letterSpacing: 0.6 }}
        >
          Первые 10 строк
        </Text>
        {sample.map((row, i) => (
          <View
            key={row.source}
            className="px-4 py-2.5"
            style={
              i < sample.length - 1
                ? { borderBottomWidth: 1, borderBottomColor: t.separator }
                : undefined
            }
          >
            <View className="flex-row items-baseline gap-2">
              <Text className="text-[11px]" style={{ color: t.faint }}>
                #{row.source}
              </Text>
              <Text
                className="flex-1 text-[14px] font-medium"
                style={{ color: t.ink }}
                numberOfLines={1}
              >
                {row.full_name || "—"}
              </Text>
              {row.phone ? (
                <Text className="text-[12px]" style={{ color: t.sub }}>
                  {row.phone}
                </Text>
              ) : null}
            </View>
            {row.reasons.length > 0 ? (
              <View className="mt-1 flex-row flex-wrap gap-1">
                {row.reasons.map((r) => (
                  <View
                    key={r}
                    className="rounded-[10px] px-1.5 py-0.5"
                    style={{ backgroundColor: t.fill }}
                  >
                    <Text
                      className="text-[11px] font-medium"
                      style={{
                        color: REASON_TONE[r] === "danger" ? t.danger : t.warning,
                      }}
                    >
                      {r}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ))}
      </Card>

      <View className="mt-2 flex-row gap-2">
        <View className="flex-1">
          <Button label="Назад" variant="secondary" onPress={onBack} />
        </View>
        <View className="flex-1">
          <Button
            label={`Импортировать ${willImport}`}
            onPress={onConfirm}
            disabled={willImport === 0}
          />
        </View>
      </View>
    </View>
  );
}

function Counter({
  t,
  value,
  label,
  tone,
}: {
  t: ReturnType<typeof useThemeColors>;
  value: number;
  label: string;
  tone: string;
}) {
  return (
    <View className="flex-1">
      <Text className="text-2xl font-bold" style={{ color: tone }}>
        {value}
      </Text>
      <Text className="text-xs" style={{ color: t.sub }}>
        {label}
      </Text>
    </View>
  );
}
