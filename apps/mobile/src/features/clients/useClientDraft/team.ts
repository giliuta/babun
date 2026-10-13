import { useTeams } from "@/features/reference/queries";
import { liveTeamChoice, teamForNewClient } from "@/features/clients/team-scope";
import { useClientsTeam } from "@/features/clients/team-pref";

/** The team a new client goes to: the booking team, else the tab chip. */
export function useNewClientTeam(
  tenantId: string | null,
  team: string | null | undefined,
): string | null {
  // КОМАНДА НОВОГО КЛИЕНТА (30.09) — чип ленты вкладки «Клиенты», из «Все» —
  // первая команда. Шлём всегда: офлайн-запись умолчания сервера не знает.
  const { data: savedTeam } = useClientsTeam(tenantId ?? null);
  const { data: teams = [] } = useTeams();
  const teamIds = teams.map((team) => team.id);
  // КОМАНДА ЗАПИСИ СИЛЬНЕЕ ЧИПА (аудит 03.10): клиент, заведённый из
  // записи, — клиент её команды. Раньше он уходил в команду последнего чипа
  // вкладки «Клиенты» (или в первую), а от команды зависят теги, страна
  // номера, поля карточки и отправитель SMS.
  const bookingTeam =
    team && (teamIds.length === 0 || teamIds.includes(team)) ? team : null;
  const newClientTeam =
    bookingTeam ?? teamForNewClient(liveTeamChoice(savedTeam, teamIds), teamIds);
  return newClientTeam;
}
