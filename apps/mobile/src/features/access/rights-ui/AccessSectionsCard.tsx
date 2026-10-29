import { Fragment, type ReactNode } from "react";

import { Divider } from "@/components/ui/Divider";
import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";

import { sectionBrief, type ViewSection } from "../master-page/rights-view-sections";
import { sectionLook } from "./right-look";

// БЛОК «ДОСТУП» НА СТРАНИЦЕ СОТРУДНИКА (постранично: тап по «Календарю»
// открывает всё, что можно предоставить). Строка — раздел приложения с
// плиткой, под именем — что в нём открыто. Тап — страница раздела со всеми
// его правами в выбранной команде.

/** Шов между строками — до текста, мимо плитки (как в «Кабинете»). */
const ROW_SEAM_INSET = 48;

export function AccessSectionsCard({
  sections,
  onOpen,
  role,
  chips,
}: {
  sections: readonly ViewSection[];
  onOpen: (section: ViewSection) => void;
  /** Строка «Роль» — над разделами (`TeamRoleRow`). */
  role?: ReactNode;
  /** ЛЕНТА КОМАНД — ВНУТРИ «ДОСТУПА», над ролью: она выбирает, чьи права
   *  ниже, и больше ничего на странице. Наверху страницы она читалась
   *  переключателем всего — имени, почты, личного. */
  chips?: ReactNode;
}) {
  if (sections.length === 0) return null;
  // ПРАВА АККАУНТА («Кабинет») — НЕ ПОД ЛЕНТОЙ: они одни на все команды, и
  // под чипом команды выглядели правами этой команды. Своей карточкой ниже.
  const team = sections.filter((section) => section.key !== "company");
  const account = sections.filter((section) => section.key === "company");
  const rows = (list: readonly ViewSection[]) =>
    list.map((section, i) => {
      const look = sectionLook(section.key);
      return (
        <Fragment key={section.key}>
          {i > 0 ? <Divider inset={ROW_SEAM_INSET} /> : null}
          <SettingsRow
            tile={look.tile}
            icon={look.icon}
            title={section.title}
            sub={sectionBrief(section, sections)}
            onPress={() => onOpen(section)}
          />
        </Fragment>
      );
    });
  return (
    <>
      {team.length > 0 || role ? (
        <SectionCard title="Доступ" padded={false}>
          {chips ?? null}
          {role ? (
            <>
              {role}
              {team.length > 0 ? <Divider inset={ROW_SEAM_INSET} /> : null}
            </>
          ) : null}
          {rows(team)}
        </SectionCard>
      ) : null}
      {account.length > 0 ? (
        <SectionCard title="Аккаунт" padded={false}>
          {rows(account)}
        </SectionCard>
      ) : null}
    </>
  );
}
