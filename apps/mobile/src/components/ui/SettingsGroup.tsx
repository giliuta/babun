import { Fragment, type ReactNode } from "react";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { Divider } from "@/components/ui/Divider";
import { SETTINGS_ROW_INSET } from "@/components/ui/tokens";

/** Группа шестерёнки: шапка и карточка строк, швы — только между теми, что
 *  остались. Пустая группа не рисуется вовсе — ни шапки, ни белой полосы.
 *  Одна на все шестерёнки (клиенты, календарь): строки одного раздела
 *  лежат одной карточкой со швами, а не каждая своей. Шапка необязательна —
 *  у страницы без подписей групп её нет. */
export function SettingsGroup({ title, rows }: { title?: string; rows: ReactNode[] }) {
  const shown = rows.filter(Boolean);
  if (shown.length === 0) return null;
  return (
    <>
      {title ? <SectionEyebrow>{title}</SectionEyebrow> : null}
      <SectionCard>
        {shown.map((row, index) => (
          <Fragment key={index}>
            {index > 0 ? <Divider inset={SETTINGS_ROW_INSET} /> : null}
            {row}
          </Fragment>
        ))}
      </SectionCard>
    </>
  );
}
