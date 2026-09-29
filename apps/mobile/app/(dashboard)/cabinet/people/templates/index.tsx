import { useRouter } from "expo-router";

import { TemplatesScreen } from "@/features/access/templates/TemplatesScreen";

// ШАБЛОНЫ ДОСТУПА — ДВЕРЬ, А НЕ ФОРМА (AGENTS, Canon Reuse п.3). Тело — в
// `features/access/templates`; сюда ведёт шестерёнка «Сотрудников».
export default function AccessTemplatesRoute() {
  const router = useRouter();
  return <TemplatesScreen onBack={() => router.back()} />;
}
