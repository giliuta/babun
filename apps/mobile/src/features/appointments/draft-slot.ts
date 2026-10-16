// ЧЕРНОВИК ФОРМЫ КАК ЗАПИСЬ ДЛЯ ПРОВЕРОК ВРЕМЕНИ (пересечение, буфер).
//
// Форма записи обязана собирать кандидата С командой: `findOverlap` и
// `findBufferClash` без `team_id` сразу отвечают «нет», и плашки
// «Пересекается с работой этой команды» и «Между записями меньше N мин» не
// загорались бы ни разу, хотя страница их честно рисует. Добавив команду,
// нельзя забыть и id: у сохранённой записи в списке дня лежит она сама, и под
// чужим id («book-draft») запись пересекалась бы сама с собой.
export interface DraftSlotInput {
  /** id сохранённой записи; null — новая. */
  editId: string | null;
  teamId: string | null;
  date: string;
  timeStart: string;
  timeEnd: string;
}

export function draftSlot(input: DraftSlotInput) {
  return {
    id: input.editId ?? "book-draft",
    team_id: input.teamId,
    date: input.date,
    time_start: input.timeStart,
    time_end: input.timeEnd,
    // Предупреждение — про КОМАНДУ, а не про жанр: командное
    // событие проверяется так же, как работа.
    kind: "work" as const,
    status: "scheduled",
  };
}
