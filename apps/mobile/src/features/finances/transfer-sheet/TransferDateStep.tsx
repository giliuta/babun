import { View } from "react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { DateSpinner } from "@/components/ui/DateSpinner";
import { GradientButton } from "@/components/ui/GradientButton";
import { FOOTER_SIDE, GUTTER } from "@/components/ui/tokens";
import { formatYMD, parseYMD } from "@/features/appointments/helpers";
import type { TransferView } from "./transfer-view";

// ─── Второй шаг: день перевода ───────────────────────────────────────────

export function renderTransferDateStep(v: TransferView) {
  const {
    visible, guard, title, setOccurredOn, dateDraft, setDateDraft, setStep,
    setFailure, dateFloor, businessToday,
  } = v;
  return (
    <BottomSheet
    padded={false}
      visible={visible && !guard.hidden}
      // Как шаг счёта: закрытие возвращает к форме без смены дня.
      onClose={() => setStep("form")}
      onExited={guard.onExited}
      title={title}
      footer={
        <View style={{ paddingHorizontal: FOOTER_SIDE }}>
          <GradientButton
            // Слово из словаря AGENTS 5.2: «Выбрать» кнопкой шторки не бывает.
            label="Применить"
            onPress={() => {
              setOccurredOn(dateDraft);
              setStep("form");
              setFailure(null);
            }}
          />
        </View>
      }
    >
      <View style={{ paddingHorizontal: GUTTER, paddingBottom: 12 }}>
        <View style={{ alignItems: "center" }}>
          {/* ПИКЕР РОЖДАЕТСЯ СО ЗНАЧЕНИЕМ. Смонтированный до того, как дата
              известна, компактный DateTimeInput навсегда запоминает
              «1 янв. 1970» — здесь `dateDraft` уже посчитан, а сам шаг
              существует только когда его открыли. */}
          <DateSpinner
            value={parseYMD(dateDraft)}
            minimumDate={parseYMD(dateFloor)}
            maximumDate={parseYMD(businessToday)}
            onChange={(date) => setDateDraft(formatYMD(date))}
          />
        </View>
      </View>
    </BottomSheet>
  );
}
