import { Text, View } from "react-native";
import { AlertTriangle, Check } from "lucide-react-native";
import { pluralRu } from "@babun/shared/common/utils/plural-ru";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import type { useThemeColors } from "@/theme/colors";
import type { ImportProgress, ImportRowsResult } from "../useImportRows";
import { ErrorNote } from "./ErrorNote";
import { progressPct } from "./wizard-rules";

export function ResultStep({
  t,
  progress,
  result,
  error,
  baseline,
  droppedCount,
  onRetryError,
  onRetryFailed,
  onDone,
}: {
  t: ReturnType<typeof useThemeColors>;
  progress: ImportProgress | null;
  result: ImportRowsResult | null;
  error: string | null;
  /** Rows an earlier run of this file already wrote (resume baseline). */
  baseline: number;
  /** Rows intentionally left out by the preview selection (empty name / bad
   *  phone / duplicate). These are «пропущено», distinct from errors. */
  droppedCount: number;
  onRetryError: () => void;
  onRetryFailed: () => void;
  onDone: () => void;
}) {
  // Error before any result — re-validate against the fresh DB and continue
  // the remainder (already-written rows won't double up).
  if (error && !result) {
    return (
      <View className="gap-4">
        <ErrorNote t={t} text={error} />
        <View className="flex-row gap-2">
          <View className="flex-1">
            <Button label="Закрыть" variant="secondary" onPress={onDone} />
          </View>
          <View className="flex-1">
            <Button label="Повторить" onPress={onRetryError} />
          </View>
        </View>
      </View>
    );
  }

  if (!result) {
    const pct = progressPct(progress);
    return (
      <Card className="gap-3 p-5">
        <View className="flex-row items-center gap-2">
          <Spinner size={20} label="Импортируем" />
          <Text className="text-[15px] font-semibold" style={{ color: t.ink }}>
            Импортируем…
          </Text>
        </View>
        <View
          className="h-2 overflow-hidden rounded-full"
          style={{ backgroundColor: t.fill }}
        >
          <View
            className="h-full rounded-full"
            style={{ width: `${pct}%`, backgroundColor: t.accent }}
          />
        </View>
        <Text className="text-xs" style={{ color: t.faint }}>
          {progress ? `${progress.done} / ${progress.total} клиентов` : "Подготавливаем…"}
        </Text>
      </Card>
    );
  }

  const errorCount = result.errors.length;
  const hasErrors = errorCount > 0;
  // «Импортировано» = rows actually written (incl. any resume baseline —
  // useImportRows seeds `inserted` with it). «Пропущено» = rows the preview
  // intentionally left out (empty name / bad phone / duplicate); errors are a
  // SEPARATE line, never folded into «пропущено».
  void baseline; // already baked into result.inserted
  const skipped = droppedCount;

  return (
    <View className="gap-4">
      <Card className="gap-3">
        <View className="flex-row items-center gap-2">
          <View
            className="h-8 w-8 items-center justify-center rounded-full"
            style={{ backgroundColor: hasErrors ? t.warning : t.success }}
          >
            {hasErrors ? (
              <AlertTriangle color="#fff" size={17} strokeWidth={2.6} />
            ) : (
              <Check color="#fff" size={18} strokeWidth={3} />
            )}
          </View>
          <Text className="text-[17px] font-bold" style={{ color: t.ink }}>
            {hasErrors ? "Импорт завершён с ошибками" : "Импорт завершён"}
          </Text>
        </View>
        <Text className="text-[14px] leading-snug" style={{ color: t.sub }}>
          Импортировано:{" "}
          <Text className="font-bold" style={{ color: t.ink }}>
            {result.inserted}
          </Text>
          {skipped > 0 ? (
            <Text>
              {" · "}Пропущено:{" "}
              <Text className="font-bold" style={{ color: t.ink }}>
                {skipped}
              </Text>
            </Text>
          ) : null}
          {hasErrors ? (
            <Text>
              {" · "}С ошибкой:{" "}
              <Text className="font-bold" style={{ color: t.warning }}>
                {errorCount}
              </Text>
            </Text>
          ) : null}
        </Text>
        {hasErrors ? (
          <View className="flex-row items-start gap-2">
            <AlertTriangle color={t.warning} size={16} strokeWidth={2.2} />
            <Text className="flex-1 text-[13px] leading-snug" style={{ color: t.warning }}>
              {errorCount} {countRowsRu(errorCount)} не {errorCount === 1 ? "прошла" : "прошли"} (первая: #{result.errors[0].source} —{" "}
              {result.errors[0].reason}).
            </Text>
          </View>
        ) : null}
      </Card>

      <View className="flex-row gap-2">
        {hasErrors ? (
          <View className="flex-1">
            <Button label="Повторить неуд." variant="secondary" onPress={onRetryFailed} />
          </View>
        ) : null}
        <View className="flex-1">
          <Button label="Готово" onPress={onDone} />
        </View>
      </View>
    </View>
  );
}

/** «строка / строки / строк» for the error line. */
function countRowsRu(n: number): string {
  // Форма числа — общим правилом: на других языках интерфейса «21» уже не «один».
  return pluralRu(n, ["строка", "строки", "строк"]);
}
