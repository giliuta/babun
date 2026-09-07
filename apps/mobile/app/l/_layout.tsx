import { Stack } from "expo-router";

// /l/<токен> — публичная страница «куда приехать мастеру» (STORY-077). Без
// входа и без гейтов: клиент открывает её по ссылке из мессенджера.
export default function LocationLinkLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
