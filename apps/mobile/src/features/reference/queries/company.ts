import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useDataRole } from "@/features/settings/tenant";
import { useClientsScopeOrNull } from "@/features/clients/company-scope";
import { tenantBoundClient } from "@/lib/tenant-bound-client";

// СПРАВОЧНИКИ ЧИТАЮТСЯ В КОМПАНИИ ЭКРАНА. Вкладка «Клиенты» открывается в
// своей компании, даже когда в календаре стоит чужая (STORY-082), и команды
// с метками ей нужны СВОИ — иначе в фильтре «Команда» рядом встают команды
// двух компаний. Вне вкладки источника нет, и всё как раньше — активная
// компания устройства.
export function useReferenceCompany() {
  const scope = useClientsScopeOrNull();
  const activeTenantId = useTenantId();
  const roleQuery = useDataRole();
  const tenantId = scope?.tenantId ?? activeTenantId;
  return {
    tenantId,
    role: scope ? scope.role : roleQuery.data,
    ready: scope ? true : roleQuery.isSuccess && roleQuery.data != null,
    client: scope && !scope.isActive ? tenantBoundClient(scope.tenantId) : supabase,
  };
}
