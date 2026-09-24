import { Stack } from "expo-router";
import { MessagingFeatureBoundary } from "@/features/chats/MessagingFeatureBoundary";
import { RoleCapabilityBoundary } from "@/features/settings/RoleCapabilityBoundary";

// ГЛАВНЫЙ ЭКРАН ВКЛАДКИ ВСЕГДА ПОД ЛЮБЫМ ЕЁ ЭКРАНОМ (владелец 2026-09-24:
// «открываю финансы, нажимаю „назад“ — перекидывает на календарь»). Экран
// вкладки, открытый снаружи — из календаря, из формы, дверью листа, по
// ссылке, — ложился в стек вкладки ОДИН, без её корня под собой, и «назад»
// уходил из вкладки на предыдущую. `initialRouteName` кладёт корень вниз
// при любом входе в стек; сторож — `tab-stack-roots.test.ts`.
export const unstable_settings = { initialRouteName: "index" };

export default function ChatsLayout() {
  return (
    <MessagingFeatureBoundary>
      <RoleCapabilityBoundary capability="manage-messaging" title="Чаты">
        <Stack screenOptions={{ headerShown: false }} />
      </RoleCapabilityBoundary>
    </MessagingFeatureBoundary>
  );
}
