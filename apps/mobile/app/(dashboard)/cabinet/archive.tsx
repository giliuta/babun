// АРХИВ — ТОНКИЙ МАРШРУТ НАД СТРАНИЦЕЙ, как `finances/requisites`: экран
// держит только адрес, всё остальное живёт в
// `features/calendar/CalendarArchiveScreen.tsx`.
//
// АДРЕС — В КАБИНЕТЕ (владелец 2026-09-21: «архив засунь в Кабинет, то есть
// если я нажимаю Кабинет, там есть вкладка „Архив“»). Экраны `/cabinet/*`
// открыты только владельцу (`canAccessCabinetPath`) — как и сами действия:
// вернуть календарь и стереть его может только он.
export { CalendarArchiveScreen as default } from "@/features/calendar/CalendarArchiveScreen";
