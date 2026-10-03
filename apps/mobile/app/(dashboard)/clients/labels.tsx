// Метки, открытые шестерёнкой листа «Метка клиента» в карточке, — маршрут
// ВНУТРИ вкладки «Клиенты». Раньше шестерёнка вела в `/cabinet/labels`:
// таб-бар переключался на «Кабинет», и «назад» уводил в его стек, а не в
// карточку (AGENTS 5.4). Экран тот же, тело в features/reference/screens.
export { LabelsScreen as default } from "@/features/reference/screens/LabelsScreen";
