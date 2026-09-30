import type { AccessBlock, AccessLevel, MemberAccessMap } from "../access-map";
import { visibleLevel, type MasterDraft } from "../master-page/master-draft";
import { offeredBlocks } from "../master-page/rights-copy";

// ЗЕРКАЛО: ЧЕРНОВИК ПРАВ → КАРТА ДОСТУПА, КАК ЕЁ ОТДАЁТ СЕРВЕР.
//
// Владелец 20.09: «делается зеркало… я могу тыкать на то, что ему можно
// видеть и что ему нельзя видеть». Экраны продукта уже умеют спрашивать права
// одной картой (`my_access_map` → `MemberAccessMap` → `accessGate`), поэтому
// зеркало не рисует макет: оно подменяет карту и показывает НАСТОЯЩИЕ экраны.
//
// Здесь собирается ровно та форма, которую вернул бы сервер для этого
// человека: положения по компании, положения по каждому его календарю и
// список прикреплений. Владельцем в зеркале человек не бывает никогда —
// иначе `accessGate` открыл бы всё и показал бы неправду.
//
// В карту идут ТОЛЬКО живые блоки: спящие сервер не проверяет, и показывать
// их действие значило бы врать вторым способом.
//
// Положение берётся тем же расчётом, что и строка страницы (`visibleLevel`).
// Сырой уровень черновика врал бы в самую опасную сторону: зеркало открывало
// бы телефоны при скрытых клиентах — то есть показывало бы владельцу как
// «безопасно» то, чего человек на самом деле не получит.

export function mirrorMapOf(
  tenantId: string,
  blocks: readonly AccessBlock[],
  draft: MasterDraft,
): MemberAccessMap {
  const live = offeredBlocks(blocks);
  const shown = visibleLevel(blocks, draft);
  const company: Record<string, AccessLevel> = {};
  const calendars: Record<string, Record<string, AccessLevel>> = {};

  for (const block of live) {
    if (block.scope === "company") {
      company[block.key] = shown(block, null);
      continue;
    }
    for (const teamId of draft.teamIds) {
      const levels = calendars[teamId] ?? (calendars[teamId] = {});
      levels[block.key] = shown(block, teamId);
    }
  }
  // Календарь без единого живого блока всё равно остаётся прикреплением:
  // человек в нём работает, просто уровней там пока нет.
  for (const teamId of draft.teamIds) {
    if (!calendars[teamId]) calendars[teamId] = {};
  }

  return {
    tenantId,
    isOwner: false,
    version: 0,
    company,
    calendars,
    attachedCalendars: [...draft.teamIds],
  };
}
