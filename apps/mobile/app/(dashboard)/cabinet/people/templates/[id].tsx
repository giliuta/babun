import { useLocalSearchParams, useRouter } from "expo-router";

import { TemplateEditScreen } from "@/features/access/templates/TemplateEditScreen";

// ОДИН ШАБЛОН ДОСТУПА — ДВЕРЬ (AGENTS, Canon Reuse п.3). Тело — в
// `features/access/templates`; маршрут достаёт из адреса только id.
export default function AccessTemplateRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const templateId = Array.isArray(id) ? id[0] : id;
  if (!templateId) return null;
  return <TemplateEditScreen id={templateId} onBack={() => router.back()} />;
}
