import { Stack, usePathname } from "expo-router";
import { RoleCapabilityBoundary } from "@/features/settings/RoleCapabilityBoundary";
import { useCurrentRole } from "@/features/settings/tenant";
import { canAccessClientPath } from "@/features/settings/role-policy";

export default function ClientsLayout() {
  const pathname = usePathname();
  const roleQuery = useCurrentRole();
  const stack = <Stack screenOptions={{ headerShown: false }} />;

  // Detail-only crew entry point. The screen uses assignment-scoped client,
  // service and appointment projections; every sibling route stays behind
  // operate-clients and therefore rejects direct links.
  if (
    roleQuery.isSuccess &&
    canAccessClientPath(roleQuery.data, pathname)
  ) {
    return stack;
  }

  return (
    <RoleCapabilityBoundary capability="operate-clients" title="Клиенты">
      {stack}
    </RoleCapabilityBoundary>
  );
}
