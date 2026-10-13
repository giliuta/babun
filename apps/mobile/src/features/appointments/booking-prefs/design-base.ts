// A team's «Дизайн» as the screens see it: the switched-off blocks and the
// full design row, derived from company settings while the team has no row.
import {
  featureOfBookingBlock,
  isFeatureOn,
} from "@babun/shared/local/company-features";
import { useDisabledFeatures } from "@/features/settings/company-features";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { useTeamDesign, type TeamBlockKey, type TeamDesign } from "../team-design";
import { BOOKING_BLOCKS, RECORD_BLOCK_KEY } from "./blocks";

/** Выключенные блоки «Дизайна» команды; без строки команды — выводятся из
 *  прежних функций компании (так переезд ничего не ломает). */
export function useTeamBlocksOff(teamId: string | null | undefined): Set<TeamBlockKey> {
  const design = useTeamDesign(teamId);
  const disabled = useDisabledFeatures();
  if (design) return new Set(design.disabledBlocks);
  const off = new Set<TeamBlockKey>();
  for (const block of BOOKING_BLOCKS) {
    const feature = featureOfBookingBlock(block.id);
    const key = RECORD_BLOCK_KEY[block.id];
    if (feature && key && !isFeatureOn(disabled, feature)) off.add(key);
  }
  return off;
}

/** Текущий «Дизайн» команды целиком — основа для патча. Без строки —
 *  собирается из настроек компании. Открыт наружу для функций клиентов
 *  команды (`clients/client-functions.ts`): патч обязан нести те же блоки
 *  записи, иначе первая же строка команды сбросила бы их. */
export function useDesignBase(teamId: string | null | undefined): TeamDesign {
  const design = useTeamDesign(teamId);
  const off = useTeamBlocksOff(teamId);
  const settings = useCalendarSettings().data;
  return (
    design ?? {
      rule: settings?.recordColorRule ?? "team",
      palette: settings?.recordColorPalette ?? null,
      fallback: settings?.recordColorFallback ?? null,
      disabledBlocks: [...off],
    }
  );
}
