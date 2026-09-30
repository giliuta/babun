import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/providers/SessionProvider";
import type { MembershipRow } from "@/features/clients/clients-company";
import { myMembershipsQueryKey } from "./my-memberships-key";

// СВОИ ЧЛЕНСТВА ЧЕЛОВЕКА — С РОЛЬЮ И ДАТОЙ ВСТУПЛЕНИЯ.
//
// Нужны вкладке «Клиенты»: она показывает клиентов СВОЕЙ компании (где человек
// владелец), даже когда в календаре открыта компания-работодатель. Лента
// календарей (`list_my_calendars`) для этого не годится: компания без активного
// календаря в ней пропадает, а порядок у неё по имени, без даты вступления.
//
// Строки читаются прямо из `tenant_members`: политика
// `tenant_members_select_owner_or_self` отдаёт человеку все его строки при любом
// заголовке компании. Поэтому ключ компанию не называет и переход переживает.

export async function fetchMyMemberships(
  client: typeof supabase,
  userId: string,
): Promise<MembershipRow[]> {
  const { data, error } = await client
    .from("tenant_members")
    .select("tenant_id, role, joined_at")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    tenantId: row.tenant_id,
    role: row.role,
    joinedAt: row.joined_at,
  }));
}

export function useMyMemberships() {
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  return useQuery({
    queryKey: myMembershipsQueryKey(userId),
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: () => fetchMyMemberships(supabase, userId as string),
  });
}
