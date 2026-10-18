import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Field } from "@/components/ui/Field";
import { GradientButton } from "@/components/ui/GradientButton";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import { DocMetaRow } from "@/components/blocks/DocMetaRow";
import { jumpMessage, numberWithSeq, skippedNumbers } from "./invoice-number-jump";
import { useSetInvoiceNextNumber, type NextInvoiceNumber } from "./invoices-queries";

// НОМЕР ИНВОЙСА — СТРОКА В БЛОКЕ «РЕКВИЗИТЫ».
//
// Номер можно выбрать вручную, и серия продолжается с выбранного: номер этого
// инвойса 104 — следующий 105-й; запоминается на реквизиты. Серия живёт на юрлице, поэтому и строка
// — в его блоке: сменил набор — видишь его номер.
//
// СВОЙ НОМЕР — В ЛЮБОЙ МОМЕНТ: номер идёт автоматически последовательно, но вместо
// 005 можно написать свой.
// Одно правило — вперёд: номер не ниже уже выданного, отказ сервер говорит
// словами («Номер 4 уже выдан — следующий может быть от 5»). Переход вперёд
// оставляет дыру в серии, поэтому перед записью человек подтверждает его,
// увидев пропадающие номера (`invoice-number-jump.ts`). Шторка — только
// владельцу.

export interface InvoiceNumberTarget {
  companyId: string;
  year: number;
  next: NextInvoiceNumber | null;
  /** Чей номер: инвойса или чека (чек — как инвойс). */
  docType?: "invoice" | "receipt";
}

export function InvoiceNumberRow({
  target,
  stacked,
  preview,
  label = "Следующий номер",
}: {
  target: InvoiceNumberTarget;
  /** Номер, каким он станет после «Сохранить» листа реквизитов: там правят
   *  буквы и длину, и строка показывает их сразу, ещё до записи. */
  preview?: string;
  /** Подпись строки: в блоке «Номер» реквизитов рядом буквы чека и
   *  кредит-ноты, и там говорим, чей это номер, — «Следующий инвойс». */
  label?: string;
  /** СТРОКОЙ ПОЛЯ — подпись сверху, номер под ней (лист реквизитов).
   *  Соседи по листу —
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
  const shown = preview ?? next?.number ?? null;

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
    const write = () =>
      save.mutate(
        { companyId: target.companyId, year: target.year, number: typed, docType: target.docType },
        {
          onSuccess: () => setOpen(false),
          onError: (error) => notify("Номер не сохранён", error.message),
        },
      );
    // Переход вперёд оставляет дыру в серии — без вопроса он не пишется.
    const skipped = skippedNumbers(next, typed);
    if (!skipped) {
      write();
      return;
    }
    confirmThen(
      `Начать с ${shown && next ? numberWithSeq(shown, typed) : String(typed)}?`,
      { message: jumpMessage(skipped), confirmLabel: "Перейти на этот номер" },
      write,
    );
  };

  return (
    <>
      {stacked ? (
        <Pressable
          onPress={editable ? () => setOpen(true) : undefined}
          disabled={!editable}
          accessibilityRole={editable ? "button" : "text"}
          accessibilityLabel={`${label}, ${shown ?? "загрузка"}`}
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
              {label}
            </Text>
            <Text
              maxFontSizeMultiplier={1.2}
              numberOfLines={1}
              style={{
                fontSize: 15,
                fontWeight: "600",
                color: shown ? t.ink : t.faint,
                fontVariant: ["tabular-nums"],
              }}
            >
              {shown ?? "…"}
            </Text>
          </View>
          {/* Шеврон: строка уводит в шторку, а не правится на месте, как
              поля над ней. Нет шторки — нет и шеврона. */}
          {editable ? <ChevronRight color={t.chevron} size={16} strokeWidth={1.75} /> : null}
        </Pressable>
      ) : (
        <DocMetaRow
          label="Номер"
          value={shown}
          onPress={editable ? () => setOpen(true) : undefined}
          accessibilityHint="Нажмите, чтобы изменить"
        />
      )}

      <BottomSheet
        visible={open}
        title={target.docType === "receipt" ? "Номер чека" : "Номер инвойса"}
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
            label={target.docType === "receipt" ? "Номер чека" : "Номер инвойса"}
            value={draft}
            onChangeText={(text) => setDraft(text.replace(/\D/g, "").slice(0, 6))}
            placeholder={next ? String(next.seq) : "104"}
            keyboardType="number-pad"
            autoFocus
            returnKeyType="done"
            onSubmitEditing={apply}
          />
          <Text style={{ fontSize: 13, color: t.sub }}>
            {shown && valid && typed != null
              ? `${numberWithSeq(shown, typed)}, следующий — ${numberWithSeq(shown, typed + 1)}.`
              : "Цифры номера. Следующие инвойсы продолжат с него."}
          </Text>
        </View>
      </BottomSheet>
    </>
  );
}
