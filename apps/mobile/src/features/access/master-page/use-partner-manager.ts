import { useCallback, useMemo } from "react";

import { useCurrentRole } from "@/features/settings/tenant";
import { useSession } from "@/providers/SessionProvider";

import type { AccessBlock, AccessLevel, MemberAccessMap } from "../access-map";
import { useMyAccess } from "../queries";
import { partnerManager, stepAllowed, teamsAllowed, type PartnerManager } from "./partner-manager";

// Хуки над `partner-manager.ts`: тот, кто смотрит, — из его роли и карты прав.

function useViewer() {
  const role = useCurrentRole().data;
  const myMap = useMyAccess().data;
  return useMemo(() => ({ role, myMap }), [role, myMap]);
}

/** Что можно с этим партнёром (директор — не себя и не директоров). */
export function usePartnerManager(userId: string, targetMap: MemberAccessMap | undefined): PartnerManager {
  const viewer = useViewer();
  const me = useSession().session?.user.id ?? null;
  return useMemo(
    () => partnerManager({ ...viewer, me }, { userId, map: targetMap }),
    [viewer, me, userId, targetMap],
  );
}

/** Ступень, которую можно поставить (директор — не выше своей). */
export function useStepAllowed(): (
  block: Pick<AccessBlock, "key" | "scope" | "levels">,
  teamId: string | null,
  step: AccessLevel,
) => boolean {
  const viewer = useViewer();
  return useCallback((block, teamId, step) => stepAllowed(viewer, block, teamId, step), [viewer]);
}

/** Команды, которые можно добавить или снять; `null` — любые. */
export function useTeamsAllowed(): ReadonlySet<string> | null {
  const viewer = useViewer();
  return useMemo(() => teamsAllowed(viewer), [viewer]);
}

/** Пускает ли право «Партнёры» на страницы партнёров и что на них можно. */
export function usePartnersAccess(): { owner: boolean; sees: boolean; manages: boolean } {
  const { role, myMap } = useViewer();
  if (role === "owner" || myMap?.isOwner) return { owner: true, sees: true, manages: true };
  const level = myMap?.company["company.partners"];
  return { owner: false, sees: level === "read" || level === "write", manages: level === "write" };
}
