import type { ReactNode } from "react";
import { useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { signOutAndWipe } from "@/lib/auth-clear";
import { useTenantId } from "@/lib/tenant";
import { useCurrentRole } from "./tenant";
import { useMyMemberships } from "./my-memberships";
import { cabinetScreenRole, canAccessCabinetPath } from "./role-policy";

// РОЛЬ РЕШАЕТ ПО КОМПАНИИ ЭКРАНА, А НЕ ПО ОТКРЫТОЙ В КАЛЕНДАРЕ.
//
// Аналитику клиентов открывают из вкладки «Клиенты», а вкладка — общая
// страница: в «Команде 1» её шапка про СВОЮ компанию и передаёт её в
// `?tenant=` (STORY-082). Владелец своей компании упирался бы здесь в
// «Недостаточно прав» только потому, что в календаре открыта чужая.
// Компанию берём не на слово: роль в ней читается из своих членств
// (`tenant_members`), и чужой идентификатор в ссылке ничего не открывает.
export function CabinetRoleBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const roleQuery = useCurrentRole();
  const activeTenantId = useTenantId();
  const { tenant } = useLocalSearchParams<{ tenant?: string }>();
  const screenTenantId = tenant && tenant !== activeTenantId ? tenant : null;
  const memberships = useMyMemberships();

  // Пока членства в пути, чужую компанию не судим: иначе на миг мелькает
  // «Недостаточно прав» на экране, который человеку открыт.
  if (screenTenantId && memberships.isPending) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Кабинет" />
        <EmptyState state="loading" fill />
      </Screen>
    );
  }

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

  const screenRole = cabinetScreenRole(role, screenTenantId, memberships.data);
  if (!canAccessCabinetPath(screenRole, pathname)) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Недостаточно прав" />
        <EmptyState
          fill
          title="Раздел доступен только владельцу"
          subtitle="Рабочие разделы остаются доступны."
          action={{ label: "В кабинет", onPress: () => router.replace("/cabinet") }}
        />
      </Screen>
    );
  }

  return <>{children}</>;
}
