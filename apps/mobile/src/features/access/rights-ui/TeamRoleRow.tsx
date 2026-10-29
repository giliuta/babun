import { useState } from "react";
import { Briefcase, ClipboardList, SlidersHorizontal, Wrench } from "lucide-react-native";

import { PickerSheet } from "@/components/ui/PickerSheet";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { confirmAction } from "@/lib/confirm";

import type { AccessBlock, AccessLevel } from "@/session/access-map";
import {
  CUSTOM_ROLE_WORD,
  ROLE_PRESETS,
  matchRole,
  roleAllowed,
  roleChanges,
  type RoleKey,
  type RolePart,
  type RolePreset,
} from "../master-page/role-presets";
import type { LevelReader } from "../master-page/rights-rows";
import type { RightLook } from "./right-look";

// СТРОКА «РОЛЬ» — ПЕРВОЙ В БЛОКЕ «ДОСТУП». Тап — шторка готовых ролей; тап
// по роли ставит все права ВЫБРАННОЙ КОМАНДЫ разом и закрывает шторку
// (одиночный выбор — без кнопки). Строки разделов под ней показывают уже
// новые положения; поправил строку руками — здесь «Своя».
//
// ПРАВА АККАУНТА — ОТДЕЛЬНЫМ ВОПРОСОМ. Тариф, SMS, история и «Партнёры» одни
// на все команды человека; роль с чипа одной команды меняла их молча. Если
// роль ставит их иначе, после шторки спрашиваем словами — и только «Да»
// меняет аккаунт. Действие строки `PickerSheet` и так выполняет, когда
// шторка уже ушла, — вопрос не ложится поверх неё.

// РОЛЬ — ОДНИМ ПИГМЕНТОМ, КОТОРОГО НЕТ У РАЗДЕЛОВ. Роли носили цвета
// разделов под ними («Директор» оранжевый — как «Кабинет», «Своя» синяя —
// как «Календарь»), и строка роли читалась ещё одним разделом. Роль различает
// значок, цвет у строки один — фиолетовый (`right-look.ts` его не берёт).
const ROLE_TILE = SETTINGS_TILE.purple;
const ROLE_LOOK: Record<RoleKey, RightLook> = {
  master: { icon: Wrench, tile: ROLE_TILE },
  lead: { icon: ClipboardList, tile: ROLE_TILE },
  director: { icon: Briefcase, tile: ROLE_TILE },
};
const CUSTOM_LOOK: RightLook = { icon: SlidersHorizontal, tile: ROLE_TILE };

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
  onApply: (role: RolePreset, part: RolePart) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = matchRole(blocks, levelOf, teamId);
  const look = current ? ROLE_LOOK[current] : CUSTOM_LOOK;
  const word = current ? (ROLE_PRESETS.find((role) => role.key === current)?.title ?? "") : CUSTOM_ROLE_WORD;
  // Роль, которую сервер отказал бы целиком (выше прав директора), в шторке
  // не стоит: строки «нельзя» без объяснения не бывает.
  const offered = ROLE_PRESETS.filter(
    (role) => !stepAllowed || roleAllowed(blocks, role, teamId, levelOf, stepAllowed, "team"),
  );
  const accountDiffers = (role: RolePreset) =>
    !!roleChanges(blocks, role, teamId, levelOf, "account") &&
    (!stepAllowed || roleAllowed(blocks, role, teamId, levelOf, stepAllowed, "account"));
  const askAccount = (role: RolePreset) => {
    void confirmAction(`Права аккаунта — как у роли «${role.title}»?`, {
      message: `Тариф, SMS, история, реквизиты и «Партнёры» — одни на все команды партнёра, не только на «${teamName}».`,
      confirmLabel: "Поставить",
    }).then((ok) => {
      if (ok) onApply(role, "account");
    });
  };
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
            if (role.key !== current) onApply(role, "team");
            if (accountDiffers(role)) askAccount(role);
          },
        }))}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
