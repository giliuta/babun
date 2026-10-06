import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useMirror } from "@/features/access/mirror/mirror-state";
import { useMyMemberships } from "@/features/settings/my-memberships";
import { tenantBoundClient } from "@/lib/tenant-bound-client";

// ИМЯ СВОЕГО АККАУНТА — «КОМПАНИЯ» НА КАРТЕ ЧЕЛОВЕКА И В «ПРОФИЛЕ» (владелец
// 06.10: «ваше имя, имя вашей компании»). Регистрация пишет одно поле «Имя
// или название компании» и в имя человека, и в `tenants.name`; здесь их
// разводят. Это то имя, которое видят партнёры в блоке пригласившего.
//
// Аккаунт — всегда СВОЙ (где человек владелец), какой бы ни был открыт на
// телефоне: читаем и пишем клиентом под его заголовком, как `OwnAccountSection`.

const KEY = "own-account-name";

export function useOwnAccountId(): string | null {
  const memberships = useMyMemberships().data ?? [];
  return memberships.find((m) => m.role === "owner")?.tenantId ?? null;
}

export function useOwnAccountName() {
  const own = useOwnAccountId();
  const mirror = useMirror();
  return useQuery({
    queryKey: [KEY, own],
    enabled: !!own && !mirror,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await tenantBoundClient(own as string)
        .from("tenants")
        .select("name")
        .eq("id", own as string)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data?.name ?? "").trim();
    },
  });
}

export function useRenameOwnAccount() {
  const own = useOwnAccountId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      if (!own) throw new Error("Аккаунт ещё не открыт — попробуйте ещё раз");
      const { error, count } = await tenantBoundClient(own)
        .from("tenants")
        .update({ name }, { count: "exact" })
        .eq("id", own);
      if (error) throw new Error(error.message);
      // RLS молча отсекает чужую строку: ноль строк — отказ, а не успех.
      if (count === 0) throw new Error("Название меняет владелец аккаунта");
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [KEY] });
      void qc.invalidateQueries({ queryKey: ["tenant"] });
    },
    meta: { errorHandled: true },
  });
}
