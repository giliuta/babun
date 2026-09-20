import { View } from "react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { GradientButton } from "@/components/ui/GradientButton";
import type { ReceiptDocument } from "./receipt-document";
import { ReceiptPaper } from "./ReceiptPaper";

// ПЕРЕД ВЫПИСКОЙ — ВСЕГДА ПОКАЗАТЬ БУМАГУ.
//
// Владелец 2026-09-20: «когда я нажимаю выставить чек, оно сначала показывает
// превью чека; я нажимаю выставить чек там, и потом можно уже отправить. Но
// перед этим всегда должно показывать превью».
//
// Здесь ничего не правят: правят блоки под листом, а лист показывает, что
// именно уйдёт клиенту. Бумага — та же `ReceiptPaper`, что печатается в PDF,
// не «похожая на неё».
//
// НОМЕРА В ПРЕВЬЮ НЕТ, ПОКА ЕГО НЕ НАЗНАЧИЛИ: настоящий выдаёт сервер под
// замком в момент выписки. Показать угаданный значит однажды показать не тот,
// что окажется на бумаге у клиента.

/** Поля листа — как у шторки «Итого». */
const SIDE = 20;

export function ReceiptPreviewSheet({
  visible,
  doc,
  busy,
  onIssue,
  onClose,
}: {
  visible: boolean;
  doc: ReceiptDocument | null;
  busy: boolean;
  onIssue: () => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Чек"
      scroll
      maxHeightRatio={0.9}
      footer={
        <View style={{ paddingHorizontal: SIDE }}>
          <GradientButton label="Выписать чек" loading={busy} onPress={onIssue} />
        </View>
      }
    >
      {doc ? (
        <View style={{ paddingHorizontal: SIDE, paddingBottom: 8 }}>
          <ReceiptPaper doc={doc} />
        </View>
      ) : null}
    </BottomSheet>
  );
}
