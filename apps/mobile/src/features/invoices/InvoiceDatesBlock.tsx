import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { DateSpinner } from "@/components/ui/DateSpinner";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { WhenRow } from "@/features/appointments/BookingSummary";
import { formatYMD, humanDay, parseYMD } from "@/features/appointments/helpers";
import { useThemeColors } from "@/theme/colors";

// ДАТЫ ИНВОЙСА — ПО АРХИТЕКТУРЕ «КОГДА» ЗАПИСИ.
//
// Владелец 2026-09-22: «перестроить выставление времени — как у нас по
// архитектуре заведено и как мы уже делали». У записи «когда» — одна белая
// плашка (`WhenRow`: день · время · пилюля длительности), тап — одна шторка с
// сегментом «Начало | Конец», барабаном и «Применить». У чека — та же
// плашка с одним днём. Инвойс берёт ровно это:
//   • плашка `WhenRow`: «вт, 22 сентября · до 29 сентября · 7 дней»;
//   • шторка «Даты»: сегмент «Выставлен | Оплатить до», барабан даты,
//     «Применить» в футере, «Без срока» тихой строкой под ним.
// Две половины со своими листами (22.09 утром) ушли — второй способ показать
// «когда», которого в продукте больше нигде нет.
//
// У выставленного документа дата выставления заморожена (по её году живёт
// номер): сегмента нет, шторка правит только срок.

function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

function daysLabel(days: number): string {
  if (days <= 0) return "в день выставления";
  const mod10 = days % 10;
  const mod100 = days % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? "день"
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? "дня"
        : "дней";
  return `${days} ${word}`;
}

/** «29 сентября» — день без недели, как второе число в плашке. */
function shortDay(ymd: string): string {
  return humanDay(ymd).replace(/^[^,]+,\s*/, "");
}

type Field = "issued" | "due";

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
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<Field>(issuedOnLocked ? "due" : "issued");
  const [draftIssued, setDraftIssued] = useState(issuedOn);
  const [draftDue, setDraftDue] = useState<string | null>(dueOn);

  // Открытие всегда с текущих дат, а не с того, что крутили в прошлый раз.
  useEffect(() => {
    if (!open) return;
    setDraftIssued(issuedOn);
    setDraftDue(dueOn);
    setField(issuedOnLocked ? "due" : "issued");
  }, [open, issuedOn, dueOn, issuedOnLocked]);

  const days = dueOn ? daysBetween(issuedOn, dueOn) : null;
  const shownDue = draftDue ?? draftIssued;

  const apply = () => {
    if (!issuedOnLocked && draftIssued !== issuedOn) onIssuedOnChange(draftIssued);
    // Срок раньше выставления не бывает — подтягиваем к дню выставления.
    const due = draftDue && draftDue < draftIssued ? draftIssued : draftDue;
    if (due !== dueOn) onDueOnChange(due);
    setOpen(false);
  };

  return (
    <>
      <WhenRow
        date={issuedOn}
        until={{
          text: dueOn ? `до ${shortDay(dueOn)}` : "без срока",
          pill: days != null ? daysLabel(days) : null,
        }}
        onPress={() => setOpen(true)}
      />

      <BottomSheet padded={false} visible={open} onClose={() => setOpen(false)}>
        <View style={{ paddingHorizontal: 20, paddingBottom: 28, paddingTop: 4, gap: 10 }}>
          <Text
            accessibilityRole="header"
            maxFontSizeMultiplier={1.2}
            style={{ fontSize: 17, fontWeight: "600", color: t.ink, textAlign: "center" }}
          >
            {field === "issued"
              ? `Выставлен · ${humanDay(draftIssued)}`
              : draftDue
                ? `Оплатить до · ${humanDay(draftDue)}`
                : "Оплатить до · без срока"}
          </Text>

          {issuedOnLocked ? null : (
            <SegmentedControl
              options={[
                { value: "issued", label: "Выставлен" },
                { value: "due", label: "Оплатить до" },
              ]}
              value={field}
              onChange={setField}
            />
          )}

          <View style={{ alignItems: "center" }}>
            {field === "issued" ? (
              <DateSpinner
                value={parseYMD(draftIssued)}
                onChange={(next) => setDraftIssued(formatYMD(next))}
              />
            ) : (
              <DateSpinner
                value={parseYMD(shownDue)}
                minimumDate={parseYMD(draftIssued)}
                onChange={(next) => setDraftDue(formatYMD(next))}
              />
            )}
          </View>

          {field === "due" ? (
            <Text style={{ fontSize: 13, color: t.sub, textAlign: "center" }}>
              {draftDue
                ? `Срок оплаты — ${daysLabel(daysBetween(draftIssued, draftDue))}`
                : "Срок не назначен — крутите барабан, чтобы поставить"}
            </Text>
          ) : null}

          <Button label="Применить" onPress={apply} />

          {field === "due" && draftDue ? (
            <Pressable
              onPress={() => setDraftDue(null)}
              accessibilityRole="button"
              accessibilityLabel="Без срока оплаты"
              style={({ pressed }) => ({
                minHeight: 44,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text style={{ fontSize: 15, fontWeight: "600", color: t.danger }}>
                Без срока
              </Text>
            </Pressable>
          ) : null}
        </View>
      </BottomSheet>
    </>
  );
}
