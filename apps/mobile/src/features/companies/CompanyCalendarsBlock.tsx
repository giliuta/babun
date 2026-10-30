import { Fragment } from "react";
import { RowCaption } from "@/components/ui/card-rows";
import { Divider } from "@/components/ui/Divider";
import { SectionCard } from "@/components/ui/SectionCard";
import { SwitchRow } from "@/components/ui/SwitchRow";

// БЛОК «КАЛЕНДАРИ» В КАРТОЧКЕ НАБОРА: какие календари выставляют документы
// от этих реквизитов. У «Основных» календарь не снимается — его отмечают в
// другом наборе, и он уходит туда сам (`company-calendars.ts`).
export function CompanyCalendarsBlock({
  teams,
  picked,
  isDefault,
  onToggle,
}: {
  teams: readonly { id: string; name: string }[];
  picked: ReadonlySet<string>;
  isDefault: boolean;
  onToggle: (teamId: string, on: boolean) => void;
}) {
  if (teams.length === 0) return null;
  return (
    <>
      <SectionCard dense title="Календари">
        {teams.map((team, index) => {
          const on = picked.has(team.id);
          return (
            <Fragment key={team.id}>
              {index > 0 ? <Divider inset={16} /> : null}
              <SwitchRow
                label={team.name}
                value={on}
                disabled={isDefault && on}
                onChange={(next) => onToggle(team.id, next)}
              />
            </Fragment>
          );
        })}
      </SectionCard>
      <RowCaption
        text={
          isDefault
            ? "Календари без своих реквизитов выставляют документы от основных."
            : "Отмеченные календари выставляют инвойсы и чеки от этих реквизитов."
        }
      />
    </>
  );
}
