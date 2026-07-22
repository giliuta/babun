import type { ReactNode } from "react";
import { usePathname, useRouter } from "expo-router";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { signOutAndWipe } from "@/lib/auth-clear";
import { useCurrentRole } from "./tenant";
import { canAccessCabinetPath, ROLE_LABELS } from "./role-policy";

export function CabinetRoleBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const roleQuery = useCurrentRole();

  if (roleQuery.isPending) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Кабинет" />
        <EmptyState state="loading" fill />
      </Screen>
    );
  }

  if (roleQuery.isError) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Кабинет" />
        <EmptyState
          state="error"
          fill
          title="Не удалось проверить права"
          subtitle="Настройки компании закрыты, пока сервер не подтвердит вашу роль."
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

  if (!canAccessCabinetPath(role, pathname)) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Недостаточно прав" />
        <EmptyState
          fill
          title="Раздел доступен только владельцу"
          subtitle={`Ваша роль — ${ROLE_LABELS[role].toLowerCase()}. Рабочие разделы остаются доступны.`}
          action={{ label: "В кабинет", onPress: () => router.replace("/cabinet") }}
        />
      </Screen>
    );
  }

  return <>{children}</>;
}
