import { Fragment, type ReactNode } from "react";
import { SectionCard } from "@/components/ui/SectionCard";
import { Divider } from "@/components/ui/Divider";
import { SETTINGS_ROW_INSET } from "@/components/ui/tokens";

/** ГРУППА ШЕСТЕРЁНКИ — ОДНА НА ВСЕ НАСТРОЙКИ (календарь, клиенты, финансы).
 *  Подпись группы — ВНУТРИ белой карточки, тем же рецептом, что у блоков
 *  записи и клиента (`SectionCard title`): три шестерёнки, собранные тремя
 *  рецептами (подпись над карточкой, внутри, без подписи), читались как три
 *  разных приложения. Подпись обязательна — короткое существительное.
 *
 *  Швы — только между строками, что остались; пустая группа не рисуется
 *  вовсе — ни подписи, ни белой полосы. `inset` — для групп без плиток
 *  (тумблер, кнопка): шов тогда от поля строки, а не от текста за плиткой. */
export function SettingsGroup({
  title,
  rows,
  inset = SETTINGS_ROW_INSET,
}: {
  title: string;
  rows: ReactNode[];
  inset?: number;
}) {
  const shown = rows.filter(Boolean);
  if (shown.length === 0) return null;
  return (
    <SectionCard title={title}>
      {shown.map((row, index) => (
        <Fragment key={index}>
          {index > 0 ? <Divider inset={inset} /> : null}
          {row}
        </Fragment>
      ))}
    </SectionCard>
  );
}
