import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Field } from "@/components/ui/Field";
import { GradientButton } from "@/components/ui/GradientButton";
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
// С 2026-10-03 СНОВА В ЛЮБОЙ МОМЕНТ (владелец: «идёт автоматически
// последовательно, но если мне нужно — вместо 005 пишу свой»; ограничение
// STORY-101 «только до первого инвойса года» снято миграцией 20261004021143).
// Одно правило — вперёд: номер не ниже уже выданного, отказ сервер говорит
// словами («Номер 4 уже выдан — следующий может быть от 5»). Шторка — только
// владельцу.

export interface InvoiceNumberTarget {
  companyId: string;
  year: number;
  next: NextInvoiceNumber | null;
  /** Чей номер: инвойса или чека (04.10, чек — как инвойс). */
  docType?: "invoice" | "receipt";
}

/** «INV-2026-104» с другим хвостом: префикс и год — из серии сервера. */
export function withSeq(number: string, seq: number): string {
  return number.replace(/(\d+)$/, (tail) => String(seq).padStart(tail.length, "0"));
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
    save.mutate(
      { companyId: target.companyId, year: target.year, number: typed, docType: target.docType },
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
        // ТОНКАЯ СТРОКА ПОД НАБОРОМ (владелец 2026-10-03: «первый блок должен
        // быть компактный, номер так сильно не выделять — ужасно выглядит»).
        // Номер — справка к реквизитам, а не главная цифра экрана: без своей
        // плитки, обычным кеглем, текст встаёт под имя набора (16 + плитка 28
        // + зазор 12).
        <Pressable
          onPress={editable ? () => setOpen(true) : undefined}
          disabled={!editable}
          accessibilityRole={editable ? "button" : "text"}
          accessibilityLabel={`Номер, ${shown ?? "загрузка"}`}
          accessibilityHint={editable ? "Нажмите, чтобы изменить" : undefined}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            minHeight: 36,
            paddingLeft: 56,
            paddingRight: 16,
            paddingBottom: 8,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text
            maxFontSizeMultiplier={1.2}
            style={{ flex: 1, fontSize: 13, fontWeight: "500", color: t.caption }}
          >
            Номер
          </Text>
          <Text
            maxFontSizeMultiplier={1.2}
            numberOfLines={1}
            style={{
              fontSize: 13,
              fontWeight: "500",
              color: shown ? t.sub : t.faint,
              fontVariant: ["tabular-nums"],
            }}
          >
            {shown ?? "…"}
          </Text>
          {editable ? <ChevronRight color={t.chevron} size={14} strokeWidth={1.75} /> : null}
        </Pressable>
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
              ? `${withSeq(shown, typed)}, следующий — ${withSeq(shown, typed + 1)}.`
              : "Цифры номера. Следующие инвойсы продолжат с него."}
          </Text>
        </View>
      </BottomSheet>
    </>
  );
}
