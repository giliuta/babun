export interface BookingServiceRef {
  id: string;
  brigade_ids: unknown;
}

export interface BookingMasterRef {
  id: string;
  team_id: string | null;
}

function brigadeIds(service: BookingServiceRef): string[] {
  return Array.isArray(service.brigade_ids)
    ? service.brigade_ids.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
}

export function isServiceAllowedForTeam(
  service: BookingServiceRef,
  teamId: string | null,
): boolean {
  const ids = brigadeIds(service);
  return ids.length === 0 || (teamId != null && ids.includes(teamId));
}

export function isMasterAllowedForTeam(
  master: BookingMasterRef | undefined,
  teamId: string | null,
): boolean {
  if (!master || teamId == null) return false;
  return master.team_id == null || master.team_id === teamId;
}

/** Central invariant used on every team change and immediately before save. */
export function reconcileBookingSelection({
  teamId,
  serviceIds,
  masterId,
  services,
  masters,
}: {
  teamId: string | null;
  serviceIds: string[];
  masterId: string | null;
  services: BookingServiceRef[];
  masters: BookingMasterRef[];
}): { serviceIds: string[]; masterId: string | null } {
  const serviceMap = new Map(services.map((service) => [service.id, service]));
  return {
    serviceIds: serviceIds.filter((id) => {
      const service = serviceMap.get(id);
      return service != null && isServiceAllowedForTeam(service, teamId);
    }),
    masterId:
      masterId &&
      isMasterAllowedForTeam(
        masters.find((master) => master.id === masterId),
        teamId,
      )
        ? masterId
        : null,
  };
}
