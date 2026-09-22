import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Hash } from "lucide-react-native";
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
// 105-й, и неважно, с какой командой … запоминается на реквизиты». Серия живёт
// на наборе реквизитов (миграция 20260922050000), поэтому и строка — в их
// блоке: сменил набор — видишь его номер. Тап — шторка с одним полем, цифры
// номера; «Применить» пишет счётчик набора, занятый номер сервер отклоняет.

export interface InvoiceNumberTarget {
  companyId: string;
  year: number;
  next: NextInvoiceNumber | null;
}

/** «INV-2026-104» с другим хвостом: префикс и год — из серии сервера. */
export function withSeq(number: string, seq: number): string {
  return number.replace(/(\d+)$/, (tail) => String(seq).padStart(tail.length, "0"));
}

export function InvoiceNumberRow({ target }: { target: InvoiceNumberTarget }) {
  const t = useThemeColors();
  const save = useSetInvoiceNextNumber();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const next = target.next;

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
      <SettingsRow
        // Плитка того же вида, что у набора над ней: одна карточка — один ряд
        // значков.
        appearance={{ fallback: Hash }}
        title="Номер"
        value={next?.number ?? "…"}
        onPress={() => setOpen(true)}
      />

      <BottomSheet
        visible={open}
        title="Номер инвойса"
        avoidKeyboard
        onClose={() => setOpen(false)}
        footer={
          <View style={{ paddingHorizontal: 16 }}>
            <GradientButton
              label="Применить"
              disabled={!valid || save.isPending}
              onPress={apply}
            />
          </View>
        }
      >
        <View style={{ gap: 10 }}>
          <Field
            label="Номер этого инвойса"
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
              ? `${withSeq(next.number, typed)}, следующий — ${withSeq(next.number, typed + 1)}. Серия общая для всех команд этих реквизитов.`
              : "Цифры номера. Следующие инвойсы продолжат с него."}
          </Text>
        </View>
      </BottomSheet>
    </>
  );
}
