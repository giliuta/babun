// Веб: сервер — единственное хранилище.
//
// На нативе офлайн-кэш держит SQLite (expo-sqlite). В браузере такого
// модуля нет, поэтому раньше bootstrap НЕ внедрял SqlAdapter вовсе, а
// getSql() бросал «No SqlAdapter configured». Расчёт был на то, что кэш
// на вебе никто не трогает — и он больше не верен: обёртки
// clientsCached / appointmentsCached / tagsCached зовут cacheUpsert на
// КАЖДОЙ записи. Из-за этого в браузере ни клиент, ни запись, ни тег не
// доезжали до сервера: исключение летело ДО сетевого вызова.
//
// NoCacheSqlAdapter закрывает дыру честно, а не тишиной. Он не хранит
// ничего:
//   * чтение — всегда промах (пустой кэш). Все читатели это уже умеют:
//     список тянет канон с сервера, readCachedX возвращает null.
//   * запись в таблицы-зеркала (clients/appointments/tags/sync_meta) —
//     выбрасывается. Кэш это КОПИЯ серверных строк; потерять копию не
//     значит потерять данные.
//   * ПОСТАНОВКА В ОЧЕРЕДЬ — громкий отказ. Это единственная строка,
//     которую нельзя проглотить: «сохраним позже» на вебе не наступит
//     никогда (реплеер смонтирован только на нативе), и молчаливое «ок»
//     означало бы ровно ту тихую потерю записи, ради которой getSql()
//     и заводили с исключением.
//
// Итог для браузера: онлайн работает как обычный клиент-сервер (кэш
// пустой, ошибки сети видно), офлайн честно говорит «нельзя».
// Настоящий персистентный веб-кэш (IndexedDB/OPFS + разблокировка
// реплеера в AppProviders) — отдельная работа, эта заглушка её не
// подменяет и не мешает: как только setSql() внедрит реальный адаптер,
// она перестанет использоваться.

import type {
  SqlAdapter,
  SqlBindParams,
  SqlRunResult,
} from "./types";

/** Единственный оператор, который нельзя выполнить «вхолостую»: он и
 *  есть обещание «сохраню позже». Ловим по имени таблицы очереди —
 *  DELETE/UPDATE по ней пропускаем (терять там нечего, а чистка кэша
 *  на выходе из аккаунта обязана проходить). */
const ENQUEUE = /^\s*INSERT\s+INTO\s+sync_queue\b/i;

/** Ошибка офлайн-записи в браузере. Текст уходит человеку в лицо, а не
 *  в консоль, поэтому он написан по-русски и без терминов. */
export class OfflineQueueUnavailableError extends Error {
  constructor() {
    super(
      "Нет сети. В браузере запись сохраняется только онлайн — " +
        "восстановите соединение и повторите.",
    );
    this.name = "OfflineQueueUnavailableError";
  }
}

const EMPTY_RESULT: SqlRunResult = { lastInsertRowId: 0, changes: 0 };

export class NoCacheSqlAdapter implements SqlAdapter {
  async execAsync(_source: string): Promise<void> {
    // DDL и чистка кэша — хранить нечего, создавать нечего.
    void _source;
  }

  async runAsync(
    source: string,
    _params?: SqlBindParams,
  ): Promise<SqlRunResult> {
    void _params;
    if (ENQUEUE.test(source)) throw new OfflineQueueUnavailableError();
    return EMPTY_RESULT;
  }

  async getAllAsync<T>(
    _source: string,
    _params?: SqlBindParams,
  ): Promise<T[]> {
    void _source;
    void _params;
    return [];
  }

  async getFirstAsync<T>(
    _source: string,
    _params?: SqlBindParams,
  ): Promise<T | null> {
    void _source;
    void _params;
    return null;
  }

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    await task();
  }

  async withExclusiveTransactionAsync(
    task: (txn: SqlAdapter) => Promise<void>,
  ): Promise<void> {
    // Атомарности здесь взяться неоткуда, но она и не нужна: пара
    // «оптимистичная строка + операция в очередь» на вебе всегда падает
    // на второй половине, а первая половина ничего не записала.
    await task(this);
  }
}
