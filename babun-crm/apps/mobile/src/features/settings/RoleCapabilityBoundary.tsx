import type { ReactNode } from "react";
import { useRouter, type Href } from "expo-router";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { signOutAndWipe } from "@/lib/auth-clear";
import { can, ROLE_LABELS, type AppCapability } from "./role-policy";
import { useCurrentRole } from "./tenant";

export function RoleCapabilityBoundary({
  capability,
  title,
  fallbackHref = "/",
  children,
}: {
  capability: AppCapability;
  title: string;
  fallbackHref?: Href;
  children: ReactNode;
}) {
  const router = useRouter();
  const roleQuery = useCurrentRole();

  if (roleQuery.isPending) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title={title} />
        <EmptyState state="loading" fill />
      </Screen>
    );
  }

  if (roleQuery.isError) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title={title} />
        <EmptyState
          state="error"
          fill
          title="Не удалось проверить права"
          subtitle="Раздел закрыт, пока сервер не подтвердит вашу роль."
          action={{ label: "Повторить", onPress: () => void roleQuery.refetch() }}
        />
      </Screen>
    );
  }

  const role = roleQuery.data;
  if (!role) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Нет доступа" />
        <EmptyState
          fill
          title="Вы больше не состоите в этой компании"
          subtitle="Войдите заново или попросите владельца восстановить доступ."
          action={{ label: "Выйти", onPress: () => void signOutAndWipe() }}
        />
      </Screen>
    );
  }

  if (!can(role, capability)) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Недостаточно прав" />
        <EmptyState
          fill
          title="Этот раздел недоступен для вашей роли"
          subtitle={`Ваша роль — ${ROLE_LABELS[role].toLowerCase()}. Доступные рабочие разделы остались без изменений.`}
          action={{ label: "Вернуться", onPress: () => router.replace(fallbackHref) }}
        />
      </Screen>
    );
  }

  return <>{children}</>;
}
