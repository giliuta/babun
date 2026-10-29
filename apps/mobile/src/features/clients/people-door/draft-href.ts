import type { Href } from "expo-router";
import type { DraftLinkParams } from "@/features/clients/useClientDraft";

/** Черновик нового клиента — ТОЙ ЖЕ дорогой, которой открыта карточка.
 *  Одна на обе двери черновика со связью: «Создать клиента» в шторке людей и
 *  «Разделить клиента» в «⋯» (`use-split-client.ts`) — разойдись они, одна из
 *  них положила бы вторую копию табов поверх записи. */
export function newClientDraftHref(
  pathname: string,
  scope: { tenantId: string; isActive: boolean } | null,
  params: DraftLinkParams & { split?: string; team?: string },
): Href {
  return pathname === "/client"
    ? { pathname: "/client", params: { id: "new", ...params } }
    : scope && !scope.isActive
      ? {
          pathname: "/clients/[id]",
          params: { id: "new", tenant: scope.tenantId, ...params },
        }
      : { pathname: "/clients/[id]", params: { id: "new", ...params } };
}
