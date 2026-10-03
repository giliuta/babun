// Ответ `create_first_calendar` (03.10): созданный календарь — или «создавать
// нечего», когда у компании уже есть живой календарь. NULL составного типа
// PostgREST отдаёт не `null`, а объектом, где все поля пустые, — его тоже
// читаем как «нечего».
export function firstCalendarFromRpc<Row extends { id: string | null }>(data: unknown): Row | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Row;
  return row.id ? row : null;
}
