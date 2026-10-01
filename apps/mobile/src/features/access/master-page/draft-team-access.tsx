import { useState, type ReactNode } from "react";
import { Keyboard } from "react-native";
import { useRouter, type Href } from "expo-router";

import type { Team } from "@/features/reference/queries";

import type { AccessBlock } from "../access-map";
import { AccessSectionsCard } from "../rights-ui/AccessSectionsCard";
import { CALENDAR_GROUPS } from "./access-summary";
import { visibleLevel, type MasterDraft } from "./master-draft";
import { activeOf } from "./rights-page-shared";
import { rightsFocusQuery } from "./rights-focus";
import { viewSections } from "./rights-view-sections";

// ЛЕНТА КОМАНД И «ДОСТУП» У НОВОГО СОТРУДНИКА И У ПРИГЛАШЕНИЯ — КАК У
// СОТРУДНИКА (владелец 01.10: «сначала сделаем полноценно… добавление
// мастера»). Черновик и приглашение рисовали команды строками, а права —
// одной длинной страницей; сотрудник — лентой команд и блоком «Доступ» по
// разделам (владелец 29.09). Теперь одна и та же страница во всех трёх
// случаях: выбрал команду в ленте — под ней её права разделами, тап по
// разделу — страница раздела.

export function useDraftTeamAccess({
  blocks,
  draft,
  teams,
  initialTeam,
  rightsHref,
  onAdd,
}: {
  blocks: readonly AccessBlock[] | undefined;
  draft: MasterDraft;
  teams: readonly Team[];
  initialTeam: string | null;
  /** Адрес страницы прав без фокуса: `/cabinet/people/new/rights?team=…`. */
  rightsHref: string;
  /** «Добавить» справа от ленты — шторка команд. */
  onAdd: () => void;
}): {
  activeId: string | null;
  select: (teamId: string) => void;
  teamChips: { activeId: string | null; onSelect: (teamId: string) => void; onAdd: () => void };
  teamRights: ReactNode;
} {
  const router = useRouter();
  const [active, setActive] = useState<string | null>(initialTeam);
  const chosen = teams.filter((team) => draft.teamIds.includes(team.id)).map((team) => team.id);
  const activeId = activeOf(active, chosen);
  const sections =
    blocks && activeId
      ? viewSections({
          blocks,
          levelOf: visibleLevel(blocks, draft),
          activeId,
          onlyCalendar: true,
          onlyCompany: false,
          withCompany: true,
        })
      : [];
  const joiner = rightsHref.includes("?") ? "&" : "?";
  return {
    activeId,
    select: setActive,
    teamChips: {
      activeId,
      onSelect: setActive,
      onAdd: () => {
        Keyboard.dismiss();
        onAdd();
      },
    },
    teamRights:
      sections.length > 0 ? (
        <AccessSectionsCard
          sections={sections}
          onOpen={(section) => {
            Keyboard.dismiss();
            const group = CALENDAR_GROUPS.find((each) => each === section.key);
            const focus =
              group && activeId
                ? rightsFocusQuery({ kind: "calendar", teamId: activeId, group })
                : rightsFocusQuery({ kind: "company" });
            router.push(`${rightsHref}${joiner}${focus}` as Href);
          }}
        />
      ) : null,
  };
}
