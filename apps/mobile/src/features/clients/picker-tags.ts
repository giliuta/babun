import type { ClientTag } from "@babun/shared/local/clients";
import { liveRowOfTeams } from "@/features/clients/serving-teams";

// КАКИЕ ТЕГИ ПРЕДЛОЖИТЬ В ШТОРКЕ КЛИЕНТА. Теги закреплены за командой:
// предлагаются теги календарей, ОБСЛУЖИВАЮЩИХ клиента (`serving-teams.ts`:
// своя команда и команды его записей, без архива). Тег другой команды,
// который на клиенте УЖЕ стоит, тоже в шторке — как скрытый тег: иначе его
// не видно и не снять, а «Применить» молча оставлял бы его в наборе.
//
// Лист без React — проверяется тестом напрямую.

export function tagsOfferedFor(
  tags: ClientTag[],
  teamIds: ReadonlySet<string>,
  selected: readonly string[],
): ClientTag[] {
  return tags.filter(
    (tag) =>
      selected.includes(tag.id) || liveRowOfTeams({ ...tag, team_id: tag.team_id ?? null }, teamIds),
  );
}
