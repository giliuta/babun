// Вход из Финансов: строка «Не закрыто» под плитками.
// Свой маршрут, а не ссылка в чужой таб: переход в другую вкладку
// переключает таб-бар и ломает «назад».
// Тело экрана живёт в src/features/finances/UnclosedScreen.tsx — один
// экран на два входа, без копии.
export { UnclosedScreen as default } from "@/features/finances/UnclosedScreen";
