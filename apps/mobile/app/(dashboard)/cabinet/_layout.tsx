import { Stack } from "expo-router";
import { CabinetRoleBoundary } from "@/features/settings/CabinetRoleBoundary";
import { MirrorReturnRetry } from "@/features/access/mirror/MirrorReturnRetry";

// ГЛАВНЫЙ ЭКРАН ВКЛАДКИ ВСЕГДА ПОД ЛЮБЫМ ЕЁ ЭКРАНОМ (иначе «назад» из
// вкладки перекидывает на предыдущую). Экран
// вкладки, открытый снаружи — из календаря, из формы, дверью листа, по
// ссылке, — ложился в стек вкладки ОДИН, без её корня под собой, и «назад»
// уходил из вкладки на предыдущую. `initialRouteName` кладёт корень вниз
// при любом входе в стек; сторож — `tab-stack-roots.test.ts`.
export const unstable_settings = { initialRouteName: "index" };

export default function CabinetLayout() {
  return (
    <CabinetRoleBoundary>
      <Stack screenOptions={{ headerShown: false }} />
      {/* Выход из «его глазами» возвращает на страницу прав. */}
      <MirrorReturnRetry />
    </CabinetRoleBoundary>
  );
}
