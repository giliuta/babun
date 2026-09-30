import { Text, View } from "react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { GradientButton } from "@/components/ui/GradientButton";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useThemeColors } from "@/theme/colors";
import type { InvoiceLanguage } from "./dictionary";
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
  blockedReason,
  language,
  onChangeLanguage,
  onIssue,
  onClose,
}: {
  visible: boolean;
  doc: InvoiceDocument | null;
  busy: boolean;
  /** «Сохранить» у выставленного, «Выставить инвойс» у нового — слово решает
   *  экран, потому что оно же стоит на его кнопке. */
  label: string;
  /** Почему выпускать ещё нельзя. Лист открывают и просто посмотреть. */
  blockedReason?: string | null;
  /** Язык бумаги — переключатель над документом. */
  language: InvoiceLanguage;
  onChangeLanguage: (next: InvoiceLanguage) => void;
  onIssue: () => void;
  onClose: () => void;
}) {
  const t = useThemeColors();
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Инвойс"
      scroll
      maxHeightRatio={0.9}
      footer={
        <View style={{ paddingHorizontal: SIDE }}>
          {blockedReason ? (
            <Text
              maxFontSizeMultiplier={1.3}
              style={{ fontSize: 13, color: t.sub, textAlign: "center", marginBottom: 8 }}
            >
              {blockedReason}
            </Text>
          ) : null}
          <GradientButton
            label={label}
            loading={busy}
            disabled={!!blockedReason}
            onPress={onIssue}
          />
        </View>
      }
    >
      {doc ? (
        <View style={{ paddingHorizontal: SIDE, paddingBottom: 8, gap: 12 }}>
          <SegmentedControl
            options={[
              { value: "ru", label: "Русский" },
              { value: "en", label: "English" },
            ]}
            value={language}
            onChange={(next) => onChangeLanguage(next as InvoiceLanguage)}
          />
          <InvoicePaper doc={doc} />
        </View>
      ) : null}
    </BottomSheet>
  );
}
