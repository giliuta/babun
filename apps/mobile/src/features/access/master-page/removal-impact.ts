// «УБРАТЬ ИЗ КОМПАНИИ» — С ЦИФРОЙ, А НЕ ВСЛЕПУЮ.
//
// Вопрос называл последствие словами («доступ пропадёт сразу»), но молчал о
// том, что владельца по-настоящему держит: у человека может быть пять выездов
// на эту неделю. Убрал в среду — в четверг некому ехать, и узнаёшь об этом от
// клиента.
//
// Канон разрушительного действия (AGENTS 7.3): вопрос называет ПОСЛЕДСТВИЕ.
// Цифра — самое честное последствие, какое у нас есть.
//
// Записи при этом НЕ пропадают: они принадлежат КАЛЕНДАРЮ (`team_id`), а не
// человеку (`master_id` у работ пуст, STORY-087). Поэтому счёт идёт по его
// календарям, и отдельная «передача» не нужна: чтобы работу вёл другой,
// его добавляют в тот же календарь. Раньше счёт искал `master_id` и всегда
// давал ноль — вопрос о цифре молчал.

/** Минимум, который нужен счёту: форма записи целиком тут ни при чём. */
export interface WorkRow {
  date: string;
  team_id?: string | null;
  status?: string | null;
  kind?: string | null;
}

/** Сколько работы впереди в календарях человека, начиная с `today`
 *  включительно. Отменённые и события не считаются. */
export function upcomingWorkCount(
  rows: readonly WorkRow[],
  teamIds: readonly string[],
  today: string,
): number {
  const teams = new Set(teamIds);
  if (teams.size === 0) return 0;
  return rows.filter(
    (row) =>
      row.kind !== "event" &&
      !!row.team_id &&
      teams.has(row.team_id) &&
      row.date >= today &&
      row.status !== "cancelled",
  ).length;
}

/** Слово о последствии для вопроса «Убрать из компании?». */
export function removalMessage(upcoming: number): string {
  const base = "Доступ ко всем календарям компании пропадёт сразу. Вернуть можно только новым приглашением.";
  if (upcoming <= 0) return base;
  // Без глагола при числе: «1 запись … останутся» ломало согласование.
  return `Впереди в его календарях: ${workWord(upcoming)}. Записи останутся в календаре. ${base}`;
}

/** «1 запись», «2 записи», «5 записей» — русский счёт без библиотек. */
function workWord(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 11 && tens <= 14) return `${count} записей`;
  if (ones === 1) return `${count} запись`;
  if (ones >= 2 && ones <= 4) return `${count} записи`;
  return `${count} записей`;
}
