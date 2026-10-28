// САМАЯ СВЕЖАЯ КОПИЯ МАССИВА КЛИЕНТА — ИЗ ВСЕГО КЭША, А НЕ ИЗ ЭКРАНА (С11).
//
// Очередь массива (`use-json-writer.ts`) одна на все экраны, а «свежайший»
// массив каждый экран приносил свой: форма записи берёт клиента из списка
// клиентов, карточка — из своего запроса, и список отстаёт. Рендер формы
// перезаписывал общий массив прежним, и следующая правка уезжала поверх него —
// только что добавленный объект пропадал. Теперь общий массив берётся из той
// копии клиента в кэше react-query, что прочитана позже всех, — где бы она ни
// лежала: в карточке, в списке, в списке источника. Лист без React:
// проверяется тестом напрямую (`freshest-client-field.test.ts`).

export interface CachedQuerySnapshot {
  data: unknown;
  /** Когда ответ лёг в кэш (мс), `query.state.dataUpdatedAt`. */
  dataUpdatedAt: number;
}

function ownField(row: unknown, ownerId: string, field: string): unknown[] | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  if (record.id !== ownerId) return null;
  const value = record[field];
  return Array.isArray(value) ? value : null;
}

/** Строка окна сотрудника (и «его глазами»): поля закрытых блоков в ней
 *  пустые, поэтому её массив — не правда о клиенте, пока есть полная копия. */
function masked(row: unknown): boolean {
  return !!row && typeof row === "object" && ("blocks" in row || "contacts_hidden" in row);
}

/** Массив `field` клиента `ownerId` из самого позднего ответа кэша, где этот
 *  клиент есть (карточка — объект, список — массив клиентов), или `null`.
 *  Полная копия главнее замаскированной: у владельца рядом может лежать
 *  строка «его глазами» с пустыми объектами — запись от неё стёрла бы их. */
export function freshestClientField(
  queries: readonly CachedQuerySnapshot[],
  ownerId: string,
  field: string,
): { items: unknown[]; at: number } | null {
  let full: { items: unknown[]; at: number } | null = null;
  let partial: { items: unknown[]; at: number } | null = null;
  for (const query of queries) {
    const data = query.data;
    const rows = Array.isArray(data) ? data : [data];
    for (const row of rows) {
      const items = ownField(row, ownerId, field);
      if (!items) continue;
      const copy = { items, at: query.dataUpdatedAt };
      if (masked(row)) {
        if (!partial || copy.at > partial.at) partial = copy;
      } else if (!full || copy.at > full.at) {
        full = copy;
      }
      break;
    }
  }
  return full ?? partial;
}

/** Брать ли копию кэша вместо общего массива: только прочитанную ПОСЛЕ
 *  завершения нашей последней записи. Раньше — это ответ, ещё не знающий
 *  нашей правки (перечитка после неё в пути), и он стёр бы её. */
export function cacheCopyWins(copyAt: number, lastWriteSettledAt: number | null): boolean {
  return lastWriteSettledAt === null || copyAt > lastWriteSettledAt;
}
