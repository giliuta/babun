// Pure rules of the «Услуги» price list: whose list is open, which services
// are templates, the order of rows and the words of a row.

import { formatCountRu } from "@babun/shared/common/utils/plural-ru";
import { parsePriceTiers } from "../economics";
import { durationLabel } from "../format";
import type { Service } from "../queries";

type TeamRef = { id: string };
type ServiceRef = Pick<Service, "team_id">;

/** The team whose price list the screen shows. */
export function pickPriceListTeam(
  teamId: string | undefined,
  fromCalendar: string | null,
  teams: readonly TeamRef[],
  allServices: readonly ServiceRef[],
): string | null {
  const calendarTeam =
    fromCalendar && teams.some((tm) => tm.id === fromCalendar)
      ? fromCalendar
      : null;
  const firstWithServices =
    teams.find((tm) => allServices.some((s) => s.team_id === tm.id))?.id ?? null;
  return (
    teamId ??
    calendarTeam ??
    firstWithServices ??
    teams[0]?.id ??
    null
  );
}

type TemplateRef = Pick<Service, "team_id" | "name" | "is_active">;

/** Live services of other teams not yet present here by name. */
export function templateCandidates<S extends TemplateRef>(
  isOwner: boolean,
  activeTeamId: string | null,
  allServices: readonly S[],
): S[] {
  if (!isOwner || !activeTeamId) return [];
  const here = new Set(
    allServices
      .filter((sv) => sv.team_id === activeTeamId)
      .map((sv) => sv.name.trim().toLowerCase()),
  );
  return allServices.filter(
    (sv) =>
      sv.is_active &&
      sv.team_id !== activeTeamId &&
      !here.has(sv.name.trim().toLowerCase()),
  );
}

/** The team's services: live first, hidden after them. */
export function teamPriceList<S extends Pick<Service, "team_id" | "is_active">>(
  everyService: readonly S[],
  activeTeamId: string | null,
): S[] {
  if (!activeTeamId) return [];
  const mine = everyService.filter((s) => s.team_id === activeTeamId);
  return [
    ...mine.filter((s) => s.is_active),
    ...mine.filter((s) => !s.is_active),
  ];
}

// СТРОКА ПРАЙСА НЕ МОЛЧИТ О ЛЕСТНИЦЕ. «A/C Cleaning · €50»
// выглядела услугой с одной ценой, а внутри лежали ещё «от 2 —
// €100» и «от 3 — €135». По этому прайсу диктуют цену по
// телефону, и он обязан сказать, что цена не одна.
// СТРОКА ГОВОРИТ, ЕСТЬ ЛИ У УСЛУГИ ЛЕСТНИЦА. Дублировать
// «€50 · 30 мин» рядом с ценой справа незачем: это одно и то
// же число дважды.
export function priceRowSub(svc: Pick<Service, "price_tiers" | "duration_minutes">): string {
  const tierCount = parsePriceTiers(svc.price_tiers).length;
  return tierCount > 0
    ? `${durationLabel(svc.duration_minutes)} · цена от количества`
    : durationLabel(svc.duration_minutes);
}

/** Question text before deleting a service for good; `used` is the number
 *  of records with it, -1 when unknown. */
export function purgeMessage(name: string, used: number): string {
  return used === 0
    ? `«${name}» ещё не стоит ни в одной записи — удалить её можно без следа.`
    : used > 0
      ? `«${name}» стоит в ${formatCountRu(used, ["записи", "записях", "записях"])}. После удаления имя работы там пропадёт, и вернуть его будет неоткуда. Если нужно просто убрать её из выбора — скройте.`
      : `«${name}» может стоять в уже сделанных записях. После удаления имя работы в них пропадёт безвозвратно. Если нужно просто убрать её из выбора — скройте.`;
}
