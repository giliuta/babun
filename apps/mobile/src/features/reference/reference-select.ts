// ОТБОР ИЗ СПРАВОЧНИКА КОМПАНИИ НА УСТРОЙСТВЕ — ТОЧНО ТАК ЖЕ, КАК ОТБИРАЛ СЕРВЕР.
//
// Метки дня, команды и услуги раньше читались несколькими ключами: по команде,
// «только активные» и «со всеми». Каждый ключ — отдельный запрос, и переход по
// календарям (или в другую компанию) ждал сеть за строками, которые уже лежали
// в соседнем ключе. Теперь запрос один — самый широкий, — а узкие читатели
// берут своё через `select` этими функциями.
//
// Условие одно и жёсткое: отбор обязан совпадать с фильтром запроса, который он
// заменил. Разойдись он — экран покажет метку чужой команды или убранную
// услугу в каталоге выбора. Поэтому функции живут листом без зависимостей и
// сверяются тестом с тем, что делал сервер. Доступа это не расширяет: широкий
// запрос читает то же, что RLS и так отдаёт этой роли в этой компании.

import type { UserRole } from "@/features/settings/role-policy";

/** Метки одной команды — зеркало `.eq("team_id", teamId)` в `fetchCities`.
 *  Без команды (пусто, `null`) — весь справочник компании, как и там: так
 *  читают экраны, которым нужно назвать метку прошлого дня. Метка без
 *  команды под фильтр команды не попадает — `eq` на `null` в Postgres ложь. */
export function pickTeamLabels<Row extends { team_id: string | null }>(
  rows: Row[],
  teamId: string | null | undefined,
): Row[] {
  if (!teamId) return rows;
  return rows.filter((row) => row.team_id === teamId);
}

/** Активные команды — зеркало `fetchTeams(..., includeInactive: false)`:
 *  у владельца это `.eq("is_active", true)`, у диспетчера и мастера — отбор
 *  `row.is_active` по той же проекции. Порядок `position` сохраняется. */
export function pickLiveTeams<Row extends { is_active: boolean }>(
  rows: Row[],
): Row[] {
  return rows.filter((row) => row.is_active);
}

/** Услуги каталога выбора — зеркало `fetchServices(..., archived: false)`.
 *
 *  Архив отсекается ТОЛЬКО у владельца: только его путь добавлял
 *  `.eq("is_active", true)`. Мастеру и диспетчеру оба варианта отдавали одну и
 *  ту же проекцию RPC, и отбор здесь сузил бы список против прежнего. */
export function pickLiveServices<Row extends { is_active: boolean }>(
  rows: Row[],
  role: UserRole | null | undefined,
): Row[] {
  if (role !== "owner") return rows;
  return rows.filter((row) => row.is_active === true);
}
