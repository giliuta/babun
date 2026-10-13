import { Fragment, type ReactNode } from "react";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { Divider } from "@/components/ui/Divider";

/** Группа шестерёнки: шапка и карточка строк, швы — только между теми, что
 *  остались. Пустая группа не рисуется вовсе — ни шапки, ни белой полосы. */
export function SettingsGroup({ title, rows }: { title: string; rows: ReactNode[] }) {
  const shown = rows.filter(Boolean);
  if (shown.length === 0) return null;
  return (
    <>
      <SectionEyebrow>{title}</SectionEyebrow>
      <SectionCard>
        {shown.map((row, index) => (
          <Fragment key={index}>
            {index > 0 ? <Divider inset={56} /> : null}
            {row}
          </Fragment>
        ))}
      </SectionCard>
    </>
  );
}
