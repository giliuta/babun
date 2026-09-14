import { InvitationsScreen } from "@/features/access/InvitationsScreen";

// «ПРИГЛАШЕНИЯ» В КАБИНЕТЕ — ДВЕРЬ, А НЕ ФОРМА (AGENTS, Canon Reuse п.3). Тело
// страницы живёт в `features/access`; сюда ведёт строка `InvitationsRow`.
export default function CabinetInvitationsRoute() {
  return <InvitationsScreen />;
}
