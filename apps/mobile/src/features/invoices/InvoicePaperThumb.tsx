import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Expand } from "lucide-react-native";
import { SectionCard } from "@/components/ui/SectionCard";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useThemeColors } from "@/theme/colors";
import type { InvoiceDocument } from "./document";
import type { InvoiceLanguage } from "./dictionary";
import { InvoicePaper } from "./InvoicePaper";

// ЖИВАЯ МИНИАТЮРА БУМАГИ НАД ФОРМОЙ.
//
// Владелец 2026-09-22: «правка слева, документ справа — с одной стороны
// нравится, с другой не очень классно выглядит». Переключатель «Правка /
// Документ» снят: форма главная, а бумага стоит над ней уменьшенной копией
// верхней части листа и меняется от каждого тапа по блокам. Тап — весь
// документ во весь лист (тот же `InvoicePreviewSheet`, что перед выпуском).
//
// Бумага рисуется В НАТУРАЛЬНУЮ ШИРИНУ и сжимается целиком, а не
// перевёрстывается под узкую карточку: миниатюра обязана выглядеть ровно как
// лист, который получит клиент, только меньше.
//
// ЯЗЫК БУМАГИ живёт здесь же, под миниатюрой: это вопрос о документе, а не о
// форме, и отдельная кнопка справа от переключателя висела сама по себе.

/** Ширина, в которой верстается бумага, — как у листа предпросмотра. */
const PAPER_W = 390;
/** Во сколько раз лист меньше настоящего: целиком виден лист до итогов. */
const SCALE = 0.56;
/** Сколько листа видно в миниатюре: шапка, стороны, позиции и итог. */
const THUMB_H = 250;

export function InvoicePaperThumb({
  doc,
  language,
  onChangeLanguage,
  onOpen,
}: {
  doc: InvoiceDocument;
  language: InvoiceLanguage;
  onChangeLanguage: (next: InvoiceLanguage) => void;
  onOpen: () => void;
}) {
  const t = useThemeColors();
  const [width, setWidth] = useState(0);
  // Уменьшенный лист стоит ПО ЦЕНТРУ на сером поле — как страница в
  // просмотрщике, а не как обрезанный край документа.
  const left = Math.max(0, (width - PAPER_W * SCALE) / 2);

  return (
    <SectionCard title="Документ">
      <View style={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 12, gap: 10 }}>
        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel="Открыть документ целиком"
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          style={({ pressed }) => ({
            height: THUMB_H,
            overflow: "hidden",
            borderRadius: t.radius.card,
            backgroundColor: t.canvas,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          {width > 0 ? (
            <View
              pointerEvents="none"
              style={{
                width: PAPER_W,
                marginLeft: left,
                marginTop: 14,
                transform: [{ scale: SCALE }],
                transformOrigin: "top left",
              }}
            >
              <InvoicePaper doc={doc} />
            </View>
          ) : null}
          {/* Лист уходит под край — подпись говорит, что дальше есть ещё. */}
          <View
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              paddingVertical: 10,
              backgroundColor: "rgba(255,255,255,0.92)",
              borderTopWidth: 1,
              borderTopColor: t.separator,
            }}
          >
            <Expand size={15} color={t.accent} strokeWidth={2.2} />
            <Text style={{ fontSize: 14, fontWeight: "600", color: t.accent }}>
              Открыть документ
            </Text>
          </View>
        </Pressable>
        <SegmentedControl
          options={[
            { value: "ru", label: "Русский" },
            { value: "en", label: "English" },
          ]}
          value={language}
          onChange={(next) => onChangeLanguage(next as InvoiceLanguage)}
        />
      </View>
    </SectionCard>
  );
}
