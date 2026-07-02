import { Stack } from "expo-router";

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* Онбординг — обязательный гейт: свайп назад на логин не должен
          «сбегать» из мастера (корневой навигатор всё равно вернёт). */}
      <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
