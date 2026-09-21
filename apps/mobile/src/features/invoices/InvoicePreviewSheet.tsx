import { View } from "react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { GradientButton } from "@/components/ui/GradientButton";
import type { InvoiceDocument } from "./document";
import { InvoicePaper } from "./InvoicePaper";

// ПЕРЕД ВЫСТАВЛЕНИЕМ — ВСЕГДА ПОКАЗАТЬ БУМАГУ.
//
// Владелец 2026-09-20 про инвойс: «после того я нажимаю выставить инвойс —
// сначала делается превью этого инвойса, и потом я нажимаю сохранить». Тот же
// порядок, что у чека, и тот же лист — `ReceiptPreviewSheet` устроен так же.
//
// Здесь ничего не правят: правят блоки под листом, а лист показывает, что
// именно уйдёт клиенту. Бумага — та же `InvoicePaper`, что печатается в PDF,
// не «похожая на неё»; ни одного обработчика ей не передаём, поэтому зоны
// бумаги не отзываются на тап и не зовут пустые приглашения.
//
// НОМЕРА В ПРЕВЬЮ МОЖЕТ НЕ БЫТЬ: настоящий выдаёт сервер под замком в момент
// выставления, а бумага печатает то, что знает документ.

/** Поля листа — как у шторки «Итого». */
const SIDE = 20;

export function InvoicePreviewSheet({
  visible,
  doc,
  busy,
  label,
  onIssue,
  onClose,
}: {
  visible: boolean;
  doc: InvoiceDocument | null;
  busy: boolean;
  /** «Сохранить» у выставленного, «Выставить инвойс» у нового — слово решает
   *  экран, потому что оно же стоит на его кнопке. */
  label: string;
  onIssue: () => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Инвойс"
      scroll
      maxHeightRatio={0.9}
      footer={
        <View style={{ paddingHorizontal: SIDE }}>
          <GradientButton label={label} loading={busy} onPress={onIssue} />
        </View>
      }
    >
      {doc ? (
        <View style={{ paddingHorizontal: SIDE, paddingBottom: 8 }}>
          <InvoicePaper doc={doc} />
        </View>
      ) : null}
    </BottomSheet>
  );
}
