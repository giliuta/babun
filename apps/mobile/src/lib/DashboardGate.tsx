import { useRef, type ReactNode } from "react";
import { Redirect } from "expo-router";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { useSession } from "@/providers/SessionProvider";
import {
  useOnboardingGate,
  useRetryOnboardingGate,
} from "@/lib/tenant";
import { shouldBlockUnresolvedTenant } from "@/lib/dashboard-gate-policy";

// Гейт приложения: без сессии — на /login, без настроенного тенанта — на
// /onboarding. Рендерится как <Redirect>, а не эффектом: незалогиненный
// пользователь уходит на логин ДО того, как календарь успеет нарисоваться
// (никакой вспышки чужого экрана на старте).
//
// Живёт отдельным компонентом, потому что гейт нужен двум корневым группам:
// табам (dashboard) и стеку настроек календаря, который лежит НАД табами.
//
// "unknown" с известным tenant id остаётся fail-open: настроенного
// пользователя нельзя выбрасывать в онбординг из-за сети. Но без tenant id
// дочерние role-boundary никогда не смогут загрузиться, поэтому такой cold
// offline start завершается явным безопасным экраном с повтором.
export function DashboardGate({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const gate = useOnboardingGate();
  const retry = useRetryOnboardingGate();

  // ОТКРЫТЫЙ КАБИНЕТ НЕ ЗАМЕНЯЕТСЯ ГЕЙТОМ. Гейт нужен на СТАРТЕ: без сессии —
  // на логин, без настроенной компании — в мастер. Но он же срабатывал ПОСРЕДИ
  // работы: переход в компанию, у которой на устройстве ещё нет штампа
  // «онбординг пройден», ронял всё дерево вкладок в «Открываем компанию» — и
  // календарь, клиенты, финансы размонтировались вместе со своим состоянием.
  // По спецификации владельца переход не меняет экран вовсе. Поэтому: если
  // кабинет уже нарисован, «загрузка» гейта — это фон, а не занавес. Ответ
  // «нужен онбординг» / «нет компании» по-прежнему уводит редиректом.
  const dashboardShown = useRef(false);

  if (!session) return <Redirect href="/login" />;
  if (gate.status === "loading" && dashboardShown.current) return <>{children}</>;
  if (gate.status === "loading") {
    return (
      <Screen edges={["top", "bottom"]}>
        <EmptyState state="loading" fill title="Открываем компанию" />
      </Screen>
    );
  }
  if (shouldBlockUnresolvedTenant(gate)) {
    return (
      <Screen edges={["top", "bottom"]}>
        <EmptyState
          state="error"
          fill
          title="Не удалось открыть компанию"
          subtitle="Проверьте интернет и повторите — данные компании не показываются, пока доступ не подтверждён."
          action={{ label: "Повторить", onPress: retry }}
        />
      </Screen>
    );
  }
  if (gate.status === "needs-onboarding" || gate.status === "no-tenant") {
    return <Redirect href="/onboarding" />;
  }
  dashboardShown.current = true;
  return <>{children}</>;
}
