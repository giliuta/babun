import { useMemo } from "react";
import type { Client } from "@babun/shared/local/clients";
import { useClientsCapabilities } from "@/features/clients/company-scope";
import { useClientFunctionOn } from "@/features/clients/client-functions";
import { useFeatureOn } from "@/features/settings/company-features";
import { cardAccess, type CardAccess } from "@/features/clients/card-access";

/** Блоки карточки этого клиента: видно ли и правится ли (`card-access.ts`). */
export function useCardAccess(client: Client | null | undefined, draft: boolean): CardAccess {
  const caps = useClientsCapabilities();
  const teamId = client?.team_id ?? null;
  // Объекты выключаются ещё и у компании — оба выключателя складываются.
  const objectsCompany = useFeatureOn("objects");
  const note = useClientFunctionOn("client_note", teamId);
  const people = useClientFunctionOn("client_people", teamId);
  const objects = useClientFunctionOn("client_objects", teamId);
  const labels = useClientFunctionOn("client_labels", teamId);
  const personal = useClientFunctionOn("client_personal", teamId);
  const files = useClientFunctionOn("client_files", teamId);
  const requisites = useClientFunctionOn("client_requisites", teamId);
  const blocks = client?.blocks;
  return useMemo(
    () =>
      cardAccess({
        client: blocks ? { blocks } : null,
        caps,
        teamOn: {
          note,
          people,
          objects: objectsCompany && objects,
          labels,
          personal,
          files,
          requisites,
        },
        draft,
      }),
    [blocks, caps, note, people, objectsCompany, objects, labels, personal, files, requisites, draft],
  );
}
