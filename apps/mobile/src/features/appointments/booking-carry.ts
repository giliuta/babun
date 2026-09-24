import {
  featureOfBookingBlock,
  type CompanyFeatureKey,
} from "@babun/shared/local/company-features";

/** Что перенести из телефона в компанию (STORY-088): выключенные там блоки
 *  записи → выключенные функции компании. `null` — переносить нечего: в
 *  телефоне ничего не хранили, или компания уже настроена и её слово
 *  главнее. Чистая функция — без React Native, проверяется тестом. */
export function localBookingCarry(
  localEnabled: readonly string[] | undefined,
  companyDisabled: readonly CompanyFeatureKey[],
  blocks: readonly { id: string; pinned?: boolean }[],
): CompanyFeatureKey[] | null {
  if (!localEnabled || companyDisabled.length > 0) return null;
  const off: CompanyFeatureKey[] = [];
  for (const block of blocks) {
    if (block.pinned || localEnabled.includes(block.id)) continue;
    // «Файлы» до 06.09 не знал ни один сохранённый список — их отсутствие
    // значит «не знали», а не «выключили».
    if (block.id === "files") continue;
    const feature = featureOfBookingBlock(block.id);
    if (feature) off.push(feature);
  }
  return off.length > 0 ? off : null;
}
