import type { ReactNode } from "react";
import type { Location } from "@babun/shared/local/clients";
import type { ClientLinkItem } from "@/features/clients/blocks/ClientLinksBlock";

// Shapes `useClientPeople` (`ClientPeopleDoor.tsx`) hands to the page.

/** Пропы жильцов для `ClientProfileBlocks`: под объектом на странице —
 *  показание, в листе объекта — строки с ролью и единственная дверь. */
export interface ResidentProps {
  residentsLine?: (loc: Location) => string | undefined;
  residentsAt?: (loc: Location) => readonly ClientLinkItem[];
  onAddResident?: (loc: Location) => void;
  onOpenResident: (item: ClientLinkItem) => void;
  onResidentRole?: (item: ClientLinkItem, role: string) => void;
  onRemoveResident?: (item: ClientLinkItem) => void;
}

export interface ClientPeople {
  /** Строки «чей он» под именем. */
  memberOfRows: ReactNode;
  /** Люди карточки в блоке «Клиент». */
  peopleRows: ReactNode;
  /** Сколько людей у карточки всего и сколько не поместилось: по ним
   *  страница рисует дверь «Все люди · N». */
  peopleTotal: number;
  peopleHidden: number;
  /** Пункт «Человек» в листе «Добавить»; нет — пункта нет. */
  onAddPerson?: () => void;
  residents: ResidentProps;
  /** Шторка выбора человека — ставится в конец экрана, вне прокрутки. */
  door: ReactNode;
}

/** ПОКАЗАНИЕ ПОД ОБЪЕКТОМ — «Мария Спиру · жилец, Андреас · жилец». Имя и
 *  роль через «·», люди через запятую: та же анатомия, что у строки связи,
 *  только без места — место здесь и есть сама строка объекта. */
export function residentsLineOf(
  rows: readonly Pick<ClientLinkItem, "name" | "role">[],
): string | undefined {
  if (rows.length === 0) return undefined;
  return rows
    .map((r) => [r.name.trim(), r.role.trim()].filter(Boolean).join(" · "))
    .join(", ");
}
