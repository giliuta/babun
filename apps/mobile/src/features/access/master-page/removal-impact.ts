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
// Записи при этом НЕ пропадают и мастера не теряют: членство в компании и
// карточка мастера — разные строки, `remove_tenant_member` трогает первую.
// Поэтому фраза говорит «останутся в календаре», а не «останутся без
// мастера» — второе было бы неправдой.

/** Минимум, который нужен счёту: форма записи целиком тут ни при чём. */
export interface WorkRow {
  date: string;
  master_id?: string | null;
  status?: string | null;
}

/** Сколько у человека работы начиная с `today` включительно. Отменённые не
 *  считаются: их отсутствие никого не подведёт. */
export function upcomingWorkCount(
  rows: readonly WorkRow[],
  masterId: string | null | undefined,
  today: string,
): number {
  if (!masterId) return 0;
  return rows.filter(
    (row) =>
      row.master_id === masterId && row.date >= today && row.status !== "cancelled",
  ).length;
}

/** Слово о последствии для вопроса «Убрать из компании?». */
export function removalMessage(upcoming: number): string {
  const base = "Доступ ко всем календарям компании пропадёт сразу. Вернуть можно только новым приглашением.";
  if (upcoming <= 0) return base;
  return `${workWord(upcoming)} останутся в календаре — ехать будет некому. ${base}`;
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
