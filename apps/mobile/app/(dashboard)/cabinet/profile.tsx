import { ProfileScreen } from "@/features/profile/ProfileScreen";

// «ПРОФИЛЬ» В КАБИНЕТЕ — ДВЕРЬ, А НЕ ФОРМА (AGENTS, Canon Reuse п.3). Тело
// страницы живёт в `features/profile`; сюда ведёт карта человека.
export default function CabinetProfileRoute() {
  return <ProfileScreen />;
}
