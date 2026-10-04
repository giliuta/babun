import type { UiLocale } from "@babun/shared/i18n/locales";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { LanguageOptionList } from "@/components/ui/LanguageOptionList";

import type { InvoiceLanguage } from "./dictionary";

// ЯЗЫК БУМАГИ ДОКУМЕНТА — инвойса и чека (владелец 2026-10-04: язык выбирают
// шторкой со всеми языками). Язык — свойство документа; дверь к шторке —
// строка «Язык» в блоке «Реквизиты» (договорённость 018/019), на странице
// выставленного инвойса пока — пункт «⋯». Список тот же, что в Кабинете →
// «Языки». Одиночный выбор: тап выбирает и закрывает, кнопки нет (AGENTS 5.2).
export function PaperLanguageSheet({
  visible,
  value,
  onChange,
  onClose,
}: {
  visible: boolean;
  value: InvoiceLanguage;
  onChange: (code: UiLocale) => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Язык" scroll padded={false} maxHeightRatio={0.75}>
      <LanguageOptionList
        selected={value}
        onPick={(code) => {
          onClose();
          if (code !== value) onChange(code);
        }}
      />
    </BottomSheet>
  );
}
