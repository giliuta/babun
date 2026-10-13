// Replay of a queued DELETE.

import type { QueuedOp } from "../../db/cache/sql";
import { assertTenantStill } from "./guards";
import { rowStillVisible, type DbSupabase, type ReplayTable } from "./relay";

export async function replayDelete(
  supabase: DbSupabase,
  op: QueuedOp,
  tableName: ReplayTable,
  /** Компания устройства всё ещё та, под которой начат слив. */
  tenantStill?: () => boolean,
): Promise<false> {
  // УДАЛЕНИЕ ОТЧИТЫВАЕТСЯ СТРОКАМИ, А НЕ МОЛЧАНИЕМ. Без `select()` ответ
  // несёт ошибку только когда сервер ОТВЕТИЛ ошибкой, а «политика не дала
  // удалить» ошибкой не считается: под RLS строка просто не находится, и
  // ноль затронутых строк приезжал сюда как успех. Операция уходила из
  // очереди, человек видел пустую очередь — и запись на месте.
  const { data: deleted, error } = await supabase
    .from(tableName)
    .delete()
    .eq("id", op.row_id)
    .select("id");
  if (error) throw new Error(`replay delete: ${error.message}`);
  if (Array.isArray(deleted) && deleted.length > 0) return false;
  assertTenantStill(tenantStill);

  // НОЛЬ СТРОК ДВУСМЫСЛЕН, и разрешает его только проверка видимости:
  //   • строки не видно — её уже удалили с другого устройства или её
  //     никогда не было. Удаление идемпотентно, это УСПЕХ, и поднимать
  //     тревогу здесь нельзя: два устройства у одного человека — норма,
  //     а не авария.
  //   • строка ВИДНА — сервер отказал именно в удалении. Это про права, а
  //     не про гонку: `view` без `edit_all` выглядит ровно так, и с
  //     правами по календарям этот случай стал обычным.
  if (await rowStillVisible(supabase, tableName, op.row_id)) {
    throw new Error("Сервер не дал удалить эту запись: нет прав на неё.");
  }
  return false;
}
