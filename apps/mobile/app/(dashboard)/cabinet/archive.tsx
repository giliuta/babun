// АРХИВ — ТОНКИЙ МАРШРУТ НАД СТРАНИЦЕЙ, как `cabinet/requisites`: экран
// держит только адрес, всё остальное живёт в
// `features/calendar/CalendarArchiveScreen.tsx`.
//
// АДРЕС — В КАБИНЕТЕ (вкладка «Архив»). Экраны `/cabinet/*`
// открыты только владельцу (`canAccessCabinetPath`) — как и сами действия:
// вернуть календарь и стереть его может только он.
export { CalendarArchiveScreen as default } from "@/features/calendar/CalendarArchiveScreen";
