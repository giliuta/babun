import { NotificationsScreen } from "@/features/cabinet/NotificationsScreen";

// «УВЕДОМЛЕНИЯ» В КАБИНЕТЕ — ДВЕРЬ, А НЕ ФОРМА (AGENTS, Canon Reuse п.3). Тело
// страницы живёт в `features/cabinet`; сюда ведёт строка `NotificationsRow`.
export default function CabinetNotificationsRoute() {
  return <NotificationsScreen />;
}
