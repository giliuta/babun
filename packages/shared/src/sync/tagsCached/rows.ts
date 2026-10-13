// Tag row builders: cache row → domain tag, server tag → cache row.

import type { ClientTag } from "../../local/clients";
import type { CachedTag } from "../../db/cache/sql";

export function rowToTag(r: CachedTag): ClientTag {
  // ВСЕ ПОЛЯ СТРОКИ, А НЕ ТРИ. Читатель кэша возвращал только имя и цвет, и
  // экран получал тег без значка, порядка и скрытия — при том что в базе они
  // уже лежали: значок «Проблемного» просто не доезжал до списка.
  return {
    id: r.id,
    name: r.name,
    color: r.color,
    icon: r.icon ?? null,
    position: r.position ?? 0,
    hidden: r.hidden ?? false,
    team_id: r.team_id || null,
  };
}

/** Server tag → cache row for the authoritative refresh. */
export function serverTagToCachedRow(tag: ClientTag, tenantId: string): CachedTag {
  return {
    id: tag.id,
    tenant_id: tenantId,
    name: tag.name,
    color: tag.color,
    icon: tag.icon ?? null,
    position: tag.position ?? 0,
    hidden: tag.hidden ?? false,
    // Команда — только если сервер её назвал: пустая строка у каждого тега
    // сломала бы сверку «данные не изменились» и гоняла перерисовку.
    ...(tag.team_id ? { team_id: tag.team_id } : {}),
  } as CachedTag;
}
