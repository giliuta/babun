import { Stack } from "expo-router";

// /b/<токен> — публичная страница онлайн-записи в календарь. Без входа и без
// гейтов: заказчик открывает её по ссылке из Instagram, Google-профиля или
// с визитки.
export default function OnlineBookingLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
