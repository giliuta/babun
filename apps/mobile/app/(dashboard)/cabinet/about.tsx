import { AboutScreen } from "@/features/cabinet/AboutScreen";

// «О ПРИЛОЖЕНИИ» В КАБИНЕТЕ — ДВЕРЬ, А НЕ ФОРМА (AGENTS, Canon Reuse п.3). Тело
// страницы живёт в `features/cabinet`; сюда ведёт строка `AboutRow`.
export default function CabinetAboutRoute() {
  return <AboutScreen />;
}
