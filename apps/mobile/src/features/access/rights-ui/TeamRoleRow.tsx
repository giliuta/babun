import { useState } from "react";
import { Briefcase, ClipboardList, SlidersHorizontal, Wrench } from "lucide-react-native";

import { PickerSheet } from "@/components/ui/PickerSheet";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";

import type { AccessBlock, AccessLevel } from "@/session/access-map";
import {
  CUSTOM_ROLE_WORD,
  ROLE_PRESETS,
  matchRole,
  roleAllowed,
  type RoleKey,
  type RolePreset,
} from "../master-page/role-presets";
import type { LevelReader } from "../master-page/rights-rows";
import type { RightLook } from "./right-look";

// СТРОКА «РОЛЬ» — ПЕРВОЙ В БЛОКЕ «ДОСТУП». Тап — шторка готовых ролей; тап
// по роли ставит все права выбранной команды разом и закрывает шторку
// (одиночный выбор — без кнопки). Строки разделов под ней показывают уже
// новые положения; поправил строку руками — здесь «Своя».

const ROLE_LOOK: Record<RoleKey, RightLook> = {
  master: { icon: Wrench, tile: SETTINGS_TILE.teal },
  lead: { icon: ClipboardList, tile: SETTINGS_TILE.indigo },
  director: { icon: Briefcase, tile: SETTINGS_TILE.orange },
};
const CUSTOM_LOOK: RightLook = { icon: SlidersHorizontal, tile: SETTINGS_TILE.blue };

export function TeamRoleRow({
  blocks,
  levelOf,
  teamId,
  teamName,
  locked,
  stepAllowed,
  onApply,
}: {
  blocks: readonly AccessBlock[];
  levelOf: LevelReader;
  teamId: string;
  teamName: string;
  /** Права отсюда не меняются — строка только показывает роль. */
  locked?: boolean;
  /** Ступень, которую может поставить тот, кто выдаёт (директор — не выше
   *  своей); нет — владелец, можно всё. */
  stepAllowed?: (block: AccessBlock, teamId: string | null, level: AccessLevel) => boolean;
  onApply: (role: RolePreset) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = matchRole(blocks, levelOf, teamId);
  const look = current ? ROLE_LOOK[current] : CUSTOM_LOOK;
  const word = current ? (ROLE_PRESETS.find((role) => role.key === current)?.title ?? "") : CUSTOM_ROLE_WORD;
  // Роль, которую сервер отказал бы целиком (выше прав директора), в шторке
  // не стоит: строки «нельзя» без объяснения не бывает.
  const offered = ROLE_PRESETS.filter(
    (role) => !stepAllowed || roleAllowed(blocks, role, teamId, levelOf, stepAllowed),
  );
  const canPick = !locked && offered.length > 0;

  return (
    <>
      <SettingsRow
        tile={look.tile}
        icon={look.icon}
        title="Роль"
        sub={word}
        onPress={canPick ? () => setOpen(true) : undefined}
      />
      <PickerSheet
        visible={open}
        title="Роль"
        subtitle={teamName}
        selectedId={current}
        items={offered.map((role) => ({
          id: role.key,
          label: role.title,
          icon: ROLE_LOOK[role.key].icon,
          color: ROLE_LOOK[role.key].tile,
          hint: role.hint,
          onPress: () => {
            if (role.key !== current) onApply(role);
          },
        }))}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
