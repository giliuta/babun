import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { localeInfo } from "@babun/shared/i18n/locales";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { GradientButton } from "@/components/ui/GradientButton";
import { LanguageOptionList } from "@/components/ui/LanguageOptionList";
import { SectionCard } from "@/components/ui/SectionCard";
import { SelectRow } from "@/components/ui/select-rows";
import { StepBack } from "@/components/ui/StepBack";
import { GUTTER } from "@/components/ui/tokens";
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

// ЯЗЫК БУМАГИ — БЛОКОМ «ЯЗЫК» НАД ДОКУМЕНТОМ (владелец 2026-10-04: «там такой
// блочок типа язык, и оно открывается шторка вниз»). Было два языка
// переключателем «Русский | English»; теперь любой язык приложения. Список
// приезжает ВТОРЫМ ШАГОМ этого же листа — лист поверх листа iOS не покажет
// (`BottomSheet` — RN Modal), так же выбирают счёт в переводе. Тап по языку
// возвращает к бумаге уже на нём.
type Step = "paper" | "language";

export function InvoicePreviewSheet({
  visible,
  doc,
  busy,
  label,
  blockedReason,
  error = null,
  language,
  onChangeLanguage,
  onIssue,
  onClose,
  title = "Инвойс",
  onExited,
}: {
  visible: boolean;
  doc: InvoiceDocument | null;
  busy: boolean;
  /** «Сохранить» у выставленного, «Выставить инвойс» у нового — слово решает
   *  экран, потому что оно же стоит на его кнопке. */
  label: string;
  /** Почему выпускать ещё нельзя. Лист открывают и просто посмотреть. */
  blockedReason?: string | null;
  /** Почему выпуск не прошёл (ответ сервера). Кнопку не гасит: поправили
   *  реквизиты, сеть вернулась — можно жать снова. */
  error?: string | null;
  /** Язык бумаги — блок «Язык» над документом. */
  language: InvoiceLanguage;
  onChangeLanguage: (next: InvoiceLanguage) => void;
  onIssue: () => void;
  onClose: () => void;
  /** Шапка листа: «Инвойс» или «Кредит-нота» (04.10). */
  title?: string;
  /** Лист уехал — экран может открыть выписанный документ (iOS не даёт
   *  открыть страницу поверх уходящей модалки). */
  onExited?: () => void;
}) {
  const t = useThemeColors();
  const [step, setStep] = useState<Step>("paper");
  // Закрыли на шаге языка — следующий раз лист открывается с бумаги.
  useEffect(() => {
    if (!visible) setStep("paper");
  }, [visible]);
  const paperLanguage = localeInfo(language);

  if (step === "language") {
    return (
      <BottomSheet
        visible={visible}
        onClose={onClose}
        title="Язык"
        scroll
        padded={false}
        maxHeightRatio={0.9}
      >
        <View style={{ paddingHorizontal: GUTTER }}>
          <StepBack onPress={() => setStep("paper")} />
        </View>
        <LanguageOptionList
          selected={language}
          onPick={(code) => {
            onChangeLanguage(code);
            setStep("paper");
          }}
        />
      </BottomSheet>
    );
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      onExited={onExited}
      title={title}
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
          ) : error ? (
            <Text
              accessibilityLiveRegion="polite"
              maxFontSizeMultiplier={1.3}
              style={{ fontSize: 13, color: t.danger, textAlign: "center", marginBottom: 8 }}
            >
              {error}
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
        <View style={{ paddingBottom: 8, gap: 12 }}>
          {/* Блок стоит по краям бумаги: у `SectionCard` свои поля GUTTER,
              бумаге лист даёт SIDE. */}
          <View style={{ marginHorizontal: SIDE - GUTTER }}>
            <SectionCard dense title="Язык">
              <View style={{ paddingHorizontal: 2, paddingVertical: 2 }}>
                <SelectRow
                  icon={paperLanguage.flag}
                  title={paperLanguage.name}
                  plain
                  accessibilityLabel={`Язык бумаги: ${paperLanguage.name}`}
                  accessibilityHint="Открывает выбор языка"
                  onPress={() => setStep("language")}
                />
              </View>
            </SectionCard>
          </View>
          <View style={{ paddingHorizontal: SIDE }}>
            <InvoicePaper doc={doc} />
          </View>
        </View>
      ) : null}
    </BottomSheet>
  );
}
