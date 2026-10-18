import type { PhoneEntry } from "@babun/shared/local/clients";

// СТАНДАРТНЫЙ НАБОР ПОДПИСЕЙ, как в контактах iPhone (сотовый, рабочий, а не
// «Второй» и не муж-жена). Родственные подписи («Супруг(а)») убраны: это про отношения,
// а не про номер, и у бизнес-клиента их не бывает.
export const EXTRA_LABELS = ["Мобильный", "Рабочий", "Домашний", "WhatsApp", "Другой"];

/** Label for a new extra number: the first standard one not used yet. */
export function nextExtraLabel(existing: PhoneEntry[]): string {
  const used = new Set(existing.map((p) => p.label));
  return EXTRA_LABELS.find((l) => !used.has(l)) ?? "Другой";
}
