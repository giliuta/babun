import { Stack } from "expo-router";

// /pay/done — куда Stripe возвращает человека, пополнившего баланс SMS из
// приложения (STORY-089). Без входа и без гейтов: браузер телефона не знает
// сессии приложения.
export default function PayLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
