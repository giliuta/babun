import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/providers/SessionProvider";
import { toMyAccounts, type AccountKind, type MyAccount, type MyAccountRow } from "./my-accounts-rows";

export type { AccountKind, MyAccount } from "./my-accounts-rows";

// МОИ АККАУНТЫ — ЛИЧНОЕ И КОМПАНИИ (владелец 11.10, PLAN-COMPANIES).
//
// У человека одно Личное (`kind = 'personal'`) и сколько угодно компаний — своих
// и тех, куда его пригласили. Имя и вид чужой компании партнёр из `tenants` не
// прочтёт (строку видит только владелец), поэтому — `list_my_accounts()` от
// `auth.uid()`. Принадлежит человеку и переживает переход (`my-accounts` в
// `PERSON_SCOPED_QUERY_HEADS`). Порядок с сервера: Личное, затем по имени.

/** Функции ещё нет в сгенерированных типах базы — узкий тип вместо `any`. */
type RpcWithMyAccounts = {
  rpc: (name: "list_my_accounts") => PromiseLike<{
    data: MyAccountRow[] | null;
    error: { message: string } | null;
  }>;
};

export const myAccountsQueryKey = (userId: string | null) => ["my-accounts", userId] as const;

export async function fetchMyAccounts(client: typeof supabase): Promise<MyAccount[]> {
  const { data, error } = await (client as unknown as RpcWithMyAccounts).rpc("list_my_accounts");
  if (error) throw new Error(error.message);
  return toMyAccounts(data ?? []);
}

export function useMyAccounts() {
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  return useQuery({
    queryKey: myAccountsQueryKey(userId),
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: () => fetchMyAccounts(supabase),
  });
}

/** Личное человека — id аккаунта или `null`, пока список не доехал. */
export function usePersonalTenantId(): string | null {
  const accounts = useMyAccounts().data;
  return accounts?.find((a) => a.kind === "personal")?.tenantId ?? null;
}

/** Вид аккаунта по id; `null` — неизвестен (список ещё не доехал). */
export function useAccountKind(tenantId: string | null | undefined): AccountKind | null {
  const accounts = useMyAccounts().data;
  if (!tenantId || !accounts) return null;
  return accounts.find((a) => a.tenantId === tenantId)?.kind ?? null;
}
