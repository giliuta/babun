// КАРТА РАСПИСАНИЙ КОМПАНИИ — ОДИН КЛЮЧ НА ВСЕ КОМАНДЫ.
//
// Раньше у каждой команды был свой ключ (`…, teamId`), хотя под капотом
// `listScheduleEntries` и так приносит карту целиком. Первый тап по ещё не
// открытому календарю шёл в сеть за той же картой, и сетка стояла скелетом
// (владелец 2026-09-15: «при переключении команд всё равно задержка»). Теперь
// кэш держит карту под `allTeamSchedulesQueryKey`, а команда выбирается
// `select` — тап по своему календарю не делает ни одного запроса.
//
// Лист без зависимостей (типы стираются при компиляции): оптимистичная правка
// карты — место, где тихо теряются изменения, поэтому она проверяется тестом
// под раннером, а не глазами.

import type { QueryClient } from "@tanstack/react-query";
import type { ScheduleMap, TeamSchedule } from "@babun/shared/local/schedule";

/** График одной команды из карты компании; `null` — строки у команды нет.
 *  Не подменяется DEFAULT_SCHEDULE: фолбэк выбирает читатель (сетка — общие
 *  рабочие часы, редактор — свой), см. `useTeamSchedule`. */
export function pickTeamSchedule(
  map: ScheduleMap | undefined,
  teamId: string | undefined,
): TeamSchedule | null {
  if (!map || !teamId) return null;
  return Object.prototype.hasOwnProperty.call(map, teamId)
    ? (map[teamId] ?? null)
    : null;
}

/** Оптимистичная запись графика одной команды в карту.
 *
 *  Меняет ТОЛЬКО эту команду: колесо времени шлёт апсерт на каждый тик, и
 *  запись «всей карты из снимка» стёрла бы правку соседней команды, сделанную
 *  секундой раньше.
 *
 *  Карты нет — НЕ ПИШЕМ (`undefined`, и `setQueryData` оставляет кэш как
 *  есть). Карта из одной правленой команды выглядела бы полной и свежей: все
 *  остальные команды читались бы «без графика», и первая же их правка
 *  собрала бы блоб из общих часов и заменила на сервере настоящий график —
 *  с перерывами, особыми днями и отпусками. Карту до записи догружает
 *  `writeTeamScheduleOptimistic`. */
export function withTeamSchedule(
  map: ScheduleMap | undefined,
  teamId: string,
  schedule: TeamSchedule,
): ScheduleMap | undefined {
  if (!map) return undefined;
  return { ...map, [teamId]: schedule };
}

/** Что откатывать, если правка не сохранится. */
export interface TeamScheduleWriteContext {
  prev: TeamSchedule | undefined;
  teamId: string;
  written: TeamSchedule;
}

/** Тело `onMutate` правки графика — листом, чтобы гонку с первой загрузкой
 *  проверял тест с настоящим `QueryClient`, а не чтение глазами.
 *
 *  ПОРЯДОК И ЕСТЬ ЗАЩИТА. Сначала карта: если её нет, дождаться
 *  (`ensureQueryData` присоединяется к уже летящей первой загрузке, а не
 *  шлёт вторую). Только потом `cancelQueries`: отмена летящей первой загрузки
 *  откатывает кэш к «данных нет», и запись после неё легла бы в пустоту —
 *  карта из одной команды. Ошибка чтения роняет мутацию ДО записи: на сервер
 *  не уходит ничего, откатывать нечего. */
export async function writeTeamScheduleOptimistic(
  qc: QueryClient,
  key: readonly unknown[],
  load: () => Promise<ScheduleMap>,
  teamId: string,
  schedule: TeamSchedule,
): Promise<TeamScheduleWriteContext> {
  if (qc.getQueryData<ScheduleMap>(key) === undefined) {
    await qc.ensureQueryData({ queryKey: key, queryFn: load });
  }
  await qc.cancelQueries({ queryKey: key });
  const map = qc.getQueryData<ScheduleMap>(key);
  const prev =
    map && Object.prototype.hasOwnProperty.call(map, teamId)
      ? map[teamId]
      : undefined;
  qc.setQueryData<ScheduleMap>(key, (current) =>
    withTeamSchedule(current, teamId, schedule),
  );
  return { prev, teamId, written: schedule };
}

/** Откат неудавшейся правки — тоже только своей команды.
 *
 *  `written` — то, что положила эта мутация, `prev` — что лежало до неё
 *  (`undefined` — строки не было). Если в карте уже другое значение, значит
 *  следом приземлилась более поздняя правка: откат не трогает её, иначе
 *  быстрая вторая правка пропала бы из-за ошибки первой. Карты нет (кэш
 *  сброшен уходом из компании) — нечего откатывать, `undefined` оставляет
 *  кэш как есть. Строки не было — убираем её: карта к моменту записи
 *  гарантированно полная (`writeTeamScheduleOptimistic`), значит у команды
 *  графика и правда нет. */
export function rollbackTeamSchedule(
  map: ScheduleMap | undefined,
  teamId: string,
  written: TeamSchedule,
  prev: TeamSchedule | undefined,
): ScheduleMap | undefined {
  if (!map) return undefined;
  const current = Object.prototype.hasOwnProperty.call(map, teamId)
    ? map[teamId]
    : undefined;
  // Сравнение значением, а не ссылкой: `setQueryData` делит структуру, и
  // равная по содержимому запись может лежать под старой ссылкой.
  if (JSON.stringify(current) !== JSON.stringify(written)) return map;
  const next: ScheduleMap = { ...map };
  if (prev === undefined) delete next[teamId];
  else next[teamId] = prev;
  return next;
}
