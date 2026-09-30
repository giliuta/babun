import { Stack } from "expo-router";

// /r/<токен> — публичная страница записи «Подтвердить / Отменить»
// (STORY-089). Без входа и без гейтов: клиент открывает её по ссылке из SMS.
export default function AppointmentLinkLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
