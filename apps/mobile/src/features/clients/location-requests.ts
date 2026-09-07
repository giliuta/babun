import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui/Toast";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import {
  isLocationRequestToken,
  locationRequestState,
  type LocationRequest,
} from "@/features/clients/location-request-link";

// ССЫЛКА КЛИЕНТУ «ОТМЕТЬТЕ АДРЕС» — данные (STORY-077). Чистые правила —
// в location-request-link.ts, действия с тостами и «Поделиться» — в
// location-request-actions.ts.
//
// Таблица `location_requests` читается по RLS (владелец и диспетчер своего
// бизнеса), выписывается только RPC `location_request_create` — токен
// рождается на сервере, — а отзыв ссылки = удаление строки.

export const locationRequestsKey = (tenantId: string | null, clientId: string) =>
  ["location-requests", tenantId, clientId] as const;

/** Ссылки клиента: живая — чтобы показать «Ждём адрес», использованная —
 *  чтобы узнать, что адрес пришёл. Пока ссылка живёт, список опрашивается
 *  раз в 20 секунд: клиент обычно отвечает сразу после отправки, и объект
 *  должен появиться у диспетчера без «потянуть, чтобы обновить». */
export function useLocationRequests(clientId: string | null) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const toast = useToast();
  const query = useQuery({
    queryKey: locationRequestsKey(tenantId, clientId ?? ""),
    enabled: !!tenantId && !!clientId,
    queryFn: async (): Promise<LocationRequest[]> => {
      const { data, error } = await supabase
        .from("location_requests")
        .select("id, client_id, token, created_at, expires_at, used_at, location_id")
        .eq("client_id", clientId as string)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw new Error(`location_requests: ${error.message}`);
      return (data ?? []) as LocationRequest[];
    },
    refetchInterval: (q) =>
      (q.state.data ?? []).some((r) => locationRequestState(r) === "pending")
        ? 20_000
        : false,
  });

  // АДРЕС ПРИШЁЛ. Объект дописан на сервере, а карточка держит старый снимок
  // клиента — перечитываем клиентов, но только когда ссылка, которую мы
  // видели живой, стала использованной: давно использованные ссылки в первом
  // же ответе не повод дёргать список.
  const seenPending = useRef<Set<string>>(new Set());
  useEffect(() => {
    let arrived = false;
    for (const r of query.data ?? []) {
      const state = locationRequestState(r);
      if (state === "pending") seenPending.current.add(r.id);
      else if (state === "used" && seenPending.current.delete(r.id)) arrived = true;
    }
    if (!arrived) return;
    void qc.invalidateQueries({ queryKey: ["clients"] });
    void qc.invalidateQueries({ queryKey: ["client"] });
    toast("Клиент прислал адрес", "success");
  }, [query.data, qc, toast]);

  return query;
}

export function useCreateLocationRequest() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (clientId: string): Promise<string> => {
      const { data, error } = await supabase.rpc("location_request_create", {
        p_client_id: clientId,
      });
      if (error) throw new Error(friendlyRequestError(error.message));
      if (!isLocationRequestToken(data)) {
        throw new Error("Сервер вернул некорректную ссылку");
      }
      return data;
    },
    onSuccess: (_token, clientId) => {
      void qc.invalidateQueries({ queryKey: locationRequestsKey(tenantId, clientId) });
    },
  });
}

export function useCancelLocationRequest() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (r: Pick<LocationRequest, "id" | "client_id">) => {
      const { error } = await supabase
        .from("location_requests")
        .delete()
        .eq("id", r.id);
      if (error) throw new Error(friendlyRequestError(error.message));
      return r.client_id;
    },
    onSuccess: (clientId) => {
      void qc.invalidateQueries({ queryKey: locationRequestsKey(tenantId, clientId) });
    },
  });
}

/** PostgREST отдаёт отказ RLS английской строкой — переводим частый случай. */
function friendlyRequestError(message: string): string {
  if (/row-level security|permission denied|42501/i.test(message)) {
    return "Ссылку выписывает владелец или диспетчер.";
  }
  return message;
}
