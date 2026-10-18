import { isCustomServiceId } from "@babun/shared/local/appointments";

export interface BookingServiceRef {
  id: string;
  /** Команда-владелец услуги. Их ровно одна: списка команд и
   *  правила «пусто = делают все» нет. */
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
      // Своя строка записи не из прайса — команде она не принадлежит, и смена
      // команды её не уносит.
      if (isCustomServiceId(id)) return true;
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

/** УСЛУГИ ЗАПИСИ ДЕРЖАТ ЕЁ В КОМАНДЕ. У каждой услуги прайса одна команда:
 *  запись, увезённая в другую команду переносом или копией, несла бы чужой
 *  прайс — сумму и состав, которых у новой команды нет. Страница записи при
 *  смене команды снимает такие услуги на глазах (`reconcileBookingSelection`),
 *  а перенос по сетке этого показать не может — поэтому он отказывает. */
export function servicesBlockTeamMove(
  serviceIds: readonly string[],
  services: readonly BookingServiceRef[],
  toTeam: string | null,
): boolean {
  const byId = new Map(services.map((service) => [service.id, service]));
  return serviceIds.some((id) => {
    if (isCustomServiceId(id)) return false;
    const service = byId.get(id);
    return service != null && !isServiceAllowedForTeam(service, toTeam);
  });
}
