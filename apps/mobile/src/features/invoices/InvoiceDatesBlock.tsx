import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Card } from "@/components/ui/Card";
import { DateWheelSheet } from "@/components/ui/DateWheelSheet";
import { humanDay } from "@/features/appointments/helpers";
import { useThemeColors } from "@/theme/colors";

// ДАТЫ ИНВОЙСА — ПЛАШКОЙ, КАК «ВРЕМЯ» В ЗАПИСИ И ДАТА В ЧЕКЕ.
//
// Владелец 2026-09-22: «измени блок даты, сделай его более красивым». Было две
// строки-настройки «Выставлен · 22 сен ›» в карточке с капс-шапкой — анкета.
// Стало то, чем в продукте уже показывают день: белая плашка без шапки
// (`WhenRow` у записи и чека), только разрезанная на две половины — когда
// выставлен и до какого числа ждём денег. Под сроком — сколько это дней: срок
// на глаз читают днями, а не датой.
//
// Тап по половине — тот же канонический барабан `DateWheelSheet`, что был у
// строк. У выставленного документа дата выставления заморожена (по её году
// живёт номер), и её половина не нажимается.

function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

function termLabel(days: number): string {
  if (days <= 0) return "в день выставления";
  const mod10 = days % 10;
  const mod100 = days % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? "день"
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? "дня"
        : "дней";
  return `через ${days} ${word}`;
}

export function InvoiceDatesBlock({
  issuedOn,
  dueOn,
  issuedOnLocked,
  onIssuedOnChange,
  onDueOnChange,
}: {
  issuedOn: string;
  dueOn: string | null;
  issuedOnLocked?: boolean;
  onIssuedOnChange: (ymd: string | null) => void;
  onDueOnChange: (ymd: string | null) => void;
}) {
  const t = useThemeColors();
  const [sheet, setSheet] = useState<"issued" | "due" | null>(null);

  const half = (
    key: "issued" | "due",
    caption: string,
    value: string,
    hint: string | null,
    muted: boolean,
    disabled: boolean,
  ) => (
    <Pressable
      onPress={() => setSheet(key)}
      disabled={disabled}
      accessibilityRole={disabled ? "text" : "button"}
      accessibilityLabel={`${caption}: ${value}${hint ? `, ${hint}` : ""}`}
      accessibilityHint={disabled ? undefined : "Открывает выбор даты"}
      style={({ pressed }) => ({
        flex: 1,
        paddingVertical: 10,
        paddingHorizontal: 14,
        backgroundColor: pressed && !disabled ? t.pressed : "transparent",
      })}
    >
      <Text style={{ fontSize: 12, fontWeight: "600", color: t.sub }}>{caption}</Text>
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
        style={{
          fontSize: 16,
          fontWeight: "700",
          color: muted ? t.placeholder : t.ink,
          marginTop: 2,
        }}
      >
        {value}
      </Text>
      {hint ? (
        <Text style={{ fontSize: 12, color: t.sub, marginTop: 1 }}>{hint}</Text>
      ) : null}
    </Pressable>
  );

  return (
    <View className="mx-4 mt-2">
      <Card style={{ flexDirection: "row", alignItems: "stretch" }}>
        {half("issued", "Выставлен", humanDay(issuedOn), null, false, !!issuedOnLocked)}
        <View style={{ width: 1, backgroundColor: t.separator, marginVertical: 10 }} />
        {half(
          "due",
          "Оплатить до",
          dueOn ? humanDay(dueOn) : "без срока",
          dueOn ? termLabel(daysBetween(issuedOn, dueOn)) : null,
          !dueOn,
          false,
        )}
      </Card>

      <DateWheelSheet
        visible={sheet === "issued"}
        title="Выставлен"
        value={issuedOn}
        seed={issuedOn}
        onApply={(ymd) => {
          onIssuedOnChange(ymd);
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
      />
      <DateWheelSheet
        visible={sheet === "due"}
        title="Оплатить до"
        value={dueOn}
        // «Оплатить до» раньше выставления не бывает.
        seed={issuedOn}
        minimumDate={issuedOn}
        clearLabel={dueOn ? "Убрать срок" : undefined}
        onApply={(ymd) => {
          onDueOnChange(ymd);
          setSheet(null);
        }}
        onClear={() => {
          onDueOnChange(null);
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
      />
    </View>
  );
}
