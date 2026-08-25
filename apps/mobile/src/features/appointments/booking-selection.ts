export interface BookingServiceRef {
  id: string;
  /** Команда-владелец услуги. С 2026-08-17 их ровно одна: списка команд и
   *  правила «пусто = делают все» больше нет. */
  team_id: string | null;
}

export interface BookingMasterRef {
  id: string;
  team_id: string | null;
}

export function isServiceAllowedForTeam(
  service: BookingServiceRef,
  teamId: string | null,
): boolean {
  // Без команды каталог ПУСТ, а не «весь»: запись без команды никто не делает,
  // и предлагать в ней чужой прайс — приглашение записать работу не на того.
  return teamId != null && service.team_id === teamId;
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
