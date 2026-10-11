// КАЛЕНДАРИ КОМПАНИИ — ТОНКИЙ МАРШРУТ НАД СТРАНИЦЕЙ, как `cabinet/archive`.
// Единственная дверь создания календаря (владелец 11.10): Кабинет → компания
// → «Календари» → «Добавить». Экран `/cabinet/*` — владельцу
// (`canAccessCabinetPath`), как и само создание.
export { CompanyCalendarsScreen as default } from "@/features/calendar/CompanyCalendarsScreen";
