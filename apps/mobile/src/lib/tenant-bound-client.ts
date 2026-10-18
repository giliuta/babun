import { supabase } from "@/lib/supabase";
import { bindTenant } from "@/lib/bind-tenant";

// ОДИН ОБЪЕКТ НА КОМПАНИЮ. Привязка без состояния (заголовок ставится на
// каждый запрос заново), а новый объект на каждый рендер ломал зависимости
// хуков: проверка дубля номера в черновике клиента чужой компании
// перезапускалась на каждом рендере, и найденный дубль крутил её по кругу —
// запрос каждые 350 мс, пока открыт черновик.
const bound = new Map<string, ReturnType<typeof bindTenant>>();

/** Единственный клиент под заголовком другой компании. Для прогрева. */
export function tenantBoundClient(tenantId: string) {
  let client = bound.get(tenantId);
  if (!client) {
    client = bindTenant(supabase, tenantId);
    bound.set(tenantId, client);
  }
  return client;
}
