// АДРЕС ПРАВ → ФОКУС СТРАНИЦЫ (STORY-087). Строка календаря на карточке
// сотрудника открывает права ЭТОГО календаря (`?calendar=<teamId>`), блок
// «Права в компании» — права компании (`?scope=company`). Лист без React:
// разбор адреса проверяется тестом.

import { CALENDAR_GROUPS, type CalendarGroup } from "./access-summary";

/** Календарный фокус может нести раздел приложения (`?group=`): строка
 *  «Календарь», «Запись» или «Финансы» в блоке «Доступ» открывает страницу
 *  только своих прав (владелец 29.09: «захожу на страницу календарь — там
 *  всё выбираю, захожу на запись — там всё»). */
export type RightsFocus =
  | { kind: "calendar"; teamId: string; group?: CalendarGroup }
  | { kind: "company" };

export function rightsFocusOf(
  calendar: string | null | undefined,
  scope: string | null | undefined,
  group?: string | null,
): RightsFocus | undefined {
  const teamId = (calendar ?? "").trim();
  const known = CALENDAR_GROUPS.find((candidate) => candidate === group);
  if (teamId) return known ? { kind: "calendar", teamId, group: known } : { kind: "calendar", teamId };
  if (scope === "company") return { kind: "company" };
  return undefined;
}

/** Хвост адреса страницы прав для фокуса. */
export function rightsFocusQuery(focus: RightsFocus): string {
  if (focus.kind === "company") return "scope=company";
  const calendar = `calendar=${encodeURIComponent(focus.teamId)}`;
  return focus.group ? `${calendar}&group=${focus.group}` : calendar;
}
