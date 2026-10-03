import type { AccessBlock, AccessLevel } from "../access-map";
import { CalendarPreview } from "./CalendarPreviews";
import { ClientCardPreview } from "./ClientCardPreviews";
import { ClientsPreview } from "./ClientsPreviews";
import { MoneyPreview } from "./MoneyPreviews";
import {
  CALENDAR_PREVIEW_KEYS,
  CLIENT_CARD_PREVIEW_KEYS,
  CLIENTS_PREVIEW_KEYS,
  MONEY_PREVIEW_KEYS,
  RECORD_PREVIEW_KEYS,
  SETTINGS_PREVIEW_KEYS,
  WINDOW_PREVIEW_KEYS,
} from "./preview-keys";
import { SettingsPreview } from "./SettingsPreviews";
import { RecordPreview } from "./RecordPreviews";
import { WindowPreview } from "./WindowPreviews";

// ВИД БЛОКА В ШТОРКЕ ПРАВА — КАКОЙ ИЗ ВИДОВ РИСОВАТЬ. Права без своего вида
// (новое в реестре, шаблоны SMS) шторку не ломают: вида просто нет, лестница
// остаётся.


export function BlockPreview({
  block,
  blocks,
  levels,
  teamName,
  teamColor,
}: {
  block: AccessBlock;
  blocks: readonly AccessBlock[];
  /** Положения всех прав этой команды — с тем, что выбрано сейчас. */
  levels: Readonly<Record<string, AccessLevel>>;
  teamName: string;
  teamColor: string;
}) {
  const key = block.key;
  if (WINDOW_PREVIEW_KEYS.includes(key)) {
    return <WindowPreview blockKey={key} level={levels[key] ?? block.levels[0]} teamColor={teamColor} />;
  }
  if (RECORD_PREVIEW_KEYS.includes(key)) {
    return <RecordPreview blockKey={key} blocks={blocks} levels={levels} teamName={teamName} teamColor={teamColor} />;
  }
  if (CALENDAR_PREVIEW_KEYS.includes(key)) {
    return <CalendarPreview blockKey={key} blocks={blocks} levels={levels} teamColor={teamColor} />;
  }
  if (MONEY_PREVIEW_KEYS.includes(key)) {
    return <MoneyPreview blockKey={key} level={levels[key] ?? block.levels[0] ?? "off"} />;
  }
  if (CLIENTS_PREVIEW_KEYS.includes(key)) {
    return <ClientsPreview blockKey={key} levels={levels} />;
  }
  if (CLIENT_CARD_PREVIEW_KEYS.includes(key)) {
    return <ClientCardPreview blockKey={key} levels={levels} />;
  }
  if (SETTINGS_PREVIEW_KEYS.includes(key)) {
    return (
      <SettingsPreview
        blockKey={key}
        level={levels[key] ?? block.levels[0] ?? "off"}
        teamName={teamName}
        teamColor={teamColor}
      />
    );
  }
  return null;
}
