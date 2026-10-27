import type { PhoneEntry } from "@babun/shared/local/clients";

// СТАНДАРТНЫЙ НАБОР ПОДПИСЕЙ, как в контактах iPhone (сотовый, рабочий, а не
// «Второй» и не муж-жена). Родственные подписи («Супруг(а)») убраны: это про отношения,
// а не про номер, и у бизнес-клиента их не бывает.
//
// В ДАННЫХ — КЛЮЧ, НА ЭКРАНЕ — ПЕРЕВОД. Плагин перевода переводит и литералы,
// и ключи объектов, поэтому ключи помечены `i18n-ignore`: в `phones[].label`
// всегда ложится русское слово-ключ, на каком бы языке ни был интерфейс. Иначе
// английский телефон писал «Mobile», русский сравнивал его с «Мобильный» — и
// подписи повторялись. Показ — `extraLabelText`, тем же порядком.
export const EXTRA_LABELS = [
  /* i18n-ignore */ "Мобильный",
  /* i18n-ignore */ "Рабочий",
  /* i18n-ignore */ "Домашний",
  "WhatsApp",
  /* i18n-ignore */ "Другой",
];
const SHOWN = ["Мобильный", "Рабочий", "Домашний", "WhatsApp", "Другой"];

/** «Другой» — ключ, которым кончается набор. */
export const OTHER_LABEL = EXTRA_LABELS[EXTRA_LABELS.length - 1];

/** Подпись для показа: свой ключ — на языке интерфейса, чужое слово (своя
 *  подпись, старые данные) — как есть. */
export function extraLabelText(label: string | null | undefined): string {
  const key = (label ?? "").trim() || OTHER_LABEL;
  const at = EXTRA_LABELS.indexOf(key);
  return at >= 0 ? SHOWN[at] : key;
}

/** Label for a new extra number: the first standard one not used yet. */
export function nextExtraLabel(existing: PhoneEntry[]): string {
  const used = new Set(existing.map((p) => p.label));
  return EXTRA_LABELS.find((l) => !used.has(l)) ?? OTHER_LABEL;
}
