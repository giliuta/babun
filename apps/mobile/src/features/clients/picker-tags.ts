import type { ClientTag } from "@babun/shared/local/clients";

// КАКИЕ ТЕГИ ПРЕДЛОЖИТЬ В ШТОРКЕ КЛИЕНТА. Теги закреплены за командой:
// предлагаются теги команды клиента и общие (без команды). Тег другой
// команды, который на клиенте УЖЕ стоит, тоже в шторке — как скрытый тег:
// иначе его не видно и не снять, а «Применить» молча оставлял бы его в наборе.
//
// Лист без React — проверяется тестом напрямую.

export function tagsOfferedFor(
  tags: ClientTag[],
  teamId: string | null,
  selected: readonly string[],
): ClientTag[] {
  if (!teamId) return tags;
  return tags.filter(
    (tag) => !tag.team_id || tag.team_id === teamId || selected.includes(tag.id),
  );
}
