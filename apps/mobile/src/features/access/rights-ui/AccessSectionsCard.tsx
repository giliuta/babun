import { Fragment } from "react";

import { Divider } from "@/components/ui/Divider";
import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";

import { sectionBrief, type ViewSection } from "../master-page/rights-view-sections";
import { sectionLook } from "./right-look";

// БЛОК «ДОСТУП» НА СТРАНИЦЕ СОТРУДНИКА (владелец 29.09: «блок доступа, первый
// доступ — Календарь; постранично: нажимаю „Календарь", и там уже полностью
// всё, что мы можем предоставить как доступ»). Строка — раздел приложения с
// плиткой, под именем — что в нём открыто. Тап — страница раздела со всеми
// его правами в выбранной команде.

/** Шов между строками — до текста, мимо плитки (как в «Кабинете»). */
const ROW_SEAM_INSET = 48;

export function AccessSectionsCard({
  sections,
  onOpen,
}: {
  sections: readonly ViewSection[];
  onOpen: (section: ViewSection) => void;
}) {
  if (sections.length === 0) return null;
  return (
    <SectionCard title="Доступ" padded={false}>
      {sections.map((section, i) => {
        const look = sectionLook(section.key);
        return (
          <Fragment key={section.key}>
            {i > 0 ? <Divider inset={ROW_SEAM_INSET} /> : null}
            <SettingsRow
              tile={look.tile}
              icon={look.icon}
              title={section.title}
              sub={sectionBrief(section)}
              onPress={() => onOpen(section)}
            />
          </Fragment>
        );
      })}
    </SectionCard>
  );
}
