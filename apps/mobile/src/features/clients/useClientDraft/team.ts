import { useTeams } from "@/features/reference/queries";
import { liveTeamChoice, teamForNewClient } from "@/features/clients/team-scope";
import { useClientsTeam } from "@/features/clients/team-pref";

/** The team a new client goes to: the booking team, else the tab chip. */
export function useNewClientTeam(
  tenantId: string | null,
  team: string | null | undefined,
): string | null {
  // КОМАНДА НОВОГО КЛИЕНТА — чип ленты вкладки «Клиенты», из «Все» —
  // первая команда. Шлём всегда: офлайн-запись умолчания сервера не знает.
  const { data: savedTeam } = useClientsTeam(tenantId ?? null);
  const { data: teams = [] } = useTeams();
  const teamIds = teams.map((team) => team.id);
  // КОМАНДА ЗАПИСИ СИЛЬНЕЕ ЧИПА: клиент, заведённый из записи, — клиент её
  // команды, а не команды последнего чипа вкладки «Клиенты» (или первой), ведь
  // от команды зависят теги, страна
  // номера, поля карточки и отправитель SMS.
  const bookingTeam =
    team && (teamIds.length === 0 || teamIds.includes(team)) ? team : null;
  const newClientTeam =
    bookingTeam ?? teamForNewClient(liveTeamChoice(savedTeam, teamIds), teamIds);
  return newClientTeam;
}
