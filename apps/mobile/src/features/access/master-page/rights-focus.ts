// АДРЕС ПРАВ → ФОКУС СТРАНИЦЫ (STORY-087). Строка календаря на карточке
// сотрудника открывает права ЭТОГО календаря (`?calendar=<teamId>`), блок
// «Права в компании» — права компании (`?scope=company`). Лист без React:
// разбор адреса проверяется тестом.

export type RightsFocus = { kind: "calendar"; teamId: string } | { kind: "company" };

export function rightsFocusOf(
  calendar: string | null | undefined,
  scope: string | null | undefined,
): RightsFocus | undefined {
  const teamId = (calendar ?? "").trim();
  if (teamId) return { kind: "calendar", teamId };
  if (scope === "company") return { kind: "company" };
  return undefined;
}

/** Хвост адреса страницы прав для фокуса. */
export function rightsFocusQuery(focus: RightsFocus): string {
  return focus.kind === "calendar"
    ? `calendar=${encodeURIComponent(focus.teamId)}`
    : "scope=company";
}
