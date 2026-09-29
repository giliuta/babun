import { CALENDAR_GROUPS, type CalendarGroup } from "./access-summary";

// АДРЕС ПРАВ → ФОКУС СТРАНИЦЫ (STORY-087). Строка календаря на карточке
// сотрудника открывает права ЭТОГО календаря (`?calendar=<teamId>`), блок
// «Права в компании» — права компании (`?scope=company`). Лист без React:
// разбор адреса проверяется тестом.
//
// РАЗДЕЛ ДОСТУПА — СВОЕЙ СТРАНИЦЕЙ (владелец 29.09: «блок „Доступ", первый
// доступ — Календарь; нажимаю „Календарь", и там полностью всё, что мы можем
// предоставить»). `&group=calendar` — только права этого раздела в этой
// команде.

export type RightsFocus =
  | { kind: "calendar"; teamId: string; group?: CalendarGroup }
  | { kind: "company" };

export function rightsFocusOf(
  calendar: string | null | undefined,
  scope: string | null | undefined,
  group?: string | null,
): RightsFocus | undefined {
  const teamId = (calendar ?? "").trim();
  if (teamId) {
    const known = CALENDAR_GROUPS.find((candidate) => candidate === group);
    return known ? { kind: "calendar", teamId, group: known } : { kind: "calendar", teamId };
  }
  if (scope === "company") return { kind: "company" };
  return undefined;
}

/** Хвост адреса страницы прав для фокуса. */
export function rightsFocusQuery(focus: RightsFocus): string {
  if (focus.kind === "company") return "scope=company";
  const base = `calendar=${encodeURIComponent(focus.teamId)}`;
  return focus.group ? `${base}&group=${focus.group}` : base;
}
