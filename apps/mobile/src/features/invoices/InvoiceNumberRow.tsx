import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronRight, Hash } from "lucide-react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Field } from "@/components/ui/Field";
import { GradientButton } from "@/components/ui/GradientButton";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import { useSetInvoiceNextNumber, type NextInvoiceNumber } from "./queries";

// НОМЕР ИНВОЙСА — СТРОКА В БЛОКЕ «РЕКВИЗИТЫ».
//
// Владелец 2026-09-22: «я могу вручную выбрать номер, и оно автоматически
// должно продолжаться с выбранного: пишу номер этого инвойса 104 — следующий
// 105-й … запоминается на реквизиты». Серия живёт на юрлице, поэтому и строка
// — в его блоке: сменил набор — видишь его номер.
//
// С 2026-10-01 (STORY-101, закон о VAT Кипра: сплошная нумерация без дыр)
// номер задаётся только СТАРТОМ серии — пока в году у юрлица нет ни одного
// инвойса (переход из прежней программы). Дальше номер двигает лишь выпуск,
// и строка становится просто строкой: без шеврона и без шторки.

export interface InvoiceNumberTarget {
  companyId: string;
  year: number;
  next: NextInvoiceNumber | null;
}

/** «INV-2026-104» с другим хвостом: префикс и год — из серии сервера. */
export function withSeq(number: string, seq: number): string {
  return number.replace(/(\d+)$/, (tail) => String(seq).padStart(tail.length, "0"));
}

export function InvoiceNumberRow({
  target,
  stacked,
}: {
  target: InvoiceNumberTarget;
  /** СТРОКОЙ ПОЛЯ — подпись сверху, номер под ней (лист реквизитов, владелец
   *  2026-09-30: «сделай стандартный наш блок с шрифтом»). Соседи по листу —
   *  поля «Юридическое имя», «IBAN» тем же видом (`FieldRow stacked`), и
   *  жирный 17-й кегль денежной строки среди них выглядел чужим. */
  stacked?: boolean;
}) {
  const t = useThemeColors();
  const save = useSetInvoiceNextNumber();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const next = target.next;
  // Шторка — только пока серию можно начать; иначе строка показывает номер.
  const editable = next?.canSetStart === true;

  // Поле открывается ПУСТЫМ, нынешний номер — подсказкой: цифры поверх
  // подставленной «1» давали «1104» вместо «104».
  useEffect(() => {
    if (open) setDraft("");
  }, [open]);

  const typed = /^\d{1,6}$/.test(draft) ? Number(draft) : null;
  const valid = typed != null && typed >= 1;

  const apply = () => {
    if (!valid || typed == null) return;
    if (next && typed === next.seq) {
      setOpen(false);
      return;
    }
    save.mutate(
      { companyId: target.companyId, year: target.year, number: typed },
      {
        onSuccess: () => setOpen(false),
        onError: (error) => notify("Номер не сохранён", error.message),
      },
    );
  };

  return (
    <>
      {stacked ? (
        <Pressable
          onPress={editable ? () => setOpen(true) : undefined}
          disabled={!editable}
          accessibilityRole={editable ? "button" : "text"}
          accessibilityLabel={`Следующий номер, ${next?.number ?? "загрузка"}`}
          accessibilityHint={editable ? "Нажмите, чтобы изменить" : undefined}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            minHeight: 60,
            paddingHorizontal: 16,
            paddingVertical: 10,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <View style={{ flex: 1 }}>
            <Text
              maxFontSizeMultiplier={1.2}
              numberOfLines={1}
              style={{ fontSize: 13, fontWeight: "500", color: t.sub, marginBottom: 2 }}
            >
              Следующий номер
            </Text>
            <Text
              maxFontSizeMultiplier={1.2}
              numberOfLines={1}
              style={{
                fontSize: 15,
                fontWeight: "600",
                color: next ? t.ink : t.faint,
                fontVariant: ["tabular-nums"],
              }}
            >
              {next?.number ?? "…"}
            </Text>
          </View>
          {/* Шеврон: строка уводит в шторку, а не правится на месте, как
              поля над ней. Нет шторки — нет и шеврона. */}
          {editable ? <ChevronRight color={t.chevron} size={16} strokeWidth={1.75} /> : null}
        </Pressable>
      ) : (
        <SettingsRow
          // Плитка того же вида, что у набора над ней: одна карточка — один ряд
          // значков.
          appearance={{ fallback: Hash }}
          title="Номер"
          value={next?.number ?? "…"}
          onPress={editable ? () => setOpen(true) : undefined}
        />
      )}

      <BottomSheet
        visible={open}
        title="Номер инвойса"
        avoidKeyboard
        onClose={() => setOpen(false)}
        // Кнопка — прямо в подвале: отступ от краёв лист даёт сам, и лишняя
        // обёртка с 16pt делала кнопку уже поля над ней.
        footer={
          <GradientButton
            label="Применить"
            disabled={!valid || save.isPending}
            onPress={apply}
          />
        }
      >
        {/* Воздух под подсказкой: без него кнопка подвала прилипала к тексту. */}
        <View style={{ gap: 10, paddingBottom: 16 }}>
          <Field
            label="Номер первого инвойса"
            value={draft}
            onChangeText={(text) => setDraft(text.replace(/\D/g, "").slice(0, 6))}
            placeholder={next ? String(next.seq) : "104"}
            keyboardType="number-pad"
            autoFocus
            returnKeyType="done"
            onSubmitEditing={apply}
          />
          <Text style={{ fontSize: 13, color: t.sub }}>
            {next && valid && typed != null
              ? `${withSeq(next.number, typed)}, следующий — ${withSeq(next.number, typed + 1)}. Номер задаётся до первого инвойса года.`
              : "Цифры номера. Следующие инвойсы продолжат с него."}
          </Text>
        </View>
      </BottomSheet>
    </>
  );
}
