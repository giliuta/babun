import { supabase } from "@/lib/supabase";
import { bindTenant } from "@/lib/bind-tenant";

/** Единственный клиент под заголовком другой компании. Для прогрева. */
export function tenantBoundClient(tenantId: string) {
  return bindTenant(supabase, tenantId);
}
