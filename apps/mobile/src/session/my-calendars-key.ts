// КЛЮЧ ЛЕНТЫ КАЛЕНДАРЕЙ — ЛИСТОМ.
//
// Его читает переход (`switch-tenant.ts`), чтобы знать компании человека без
// `getSession()`. А переход импортирует `workspaces.ts` — ключ оттуда замкнул
// бы круг импортов. `workspaces.ts` реэкспортирует его для всех прежних мест.
export const myCalendarsQueryKey = ["my-calendars"] as const;
