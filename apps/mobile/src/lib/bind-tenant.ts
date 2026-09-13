import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@babun/shared/db/database.types";
import { BOUND_TENANT_FIELD } from "@babun/shared/sync/replayer";
import { TENANT_HEADER } from "./tenant-header";

// КЛИЕНТ, ПРИВЯЗАННЫЙ К ОДНОЙ КОМПАНИИ.
//
// Нужен прогреву: пока устройство стоит в компании A, приложение заранее
// скачивает первый экран компании B, чтобы первый же переход в неё был
// мгновенным. Запросы B обязаны уйти с заголовком B, а активная компания при
// этом не меняется — иначе прогрев превратился бы в переход.
//
// Это ВИД на единственный клиент, а не второй клиент: сессия, токен и его
// обновление остаются одни на всех. Наружу торчат только `from` и `rpc` —
// ровно то, чем читают справочники и безопасные функции. `auth`, `storage`,
// `channel` НЕ ВЫДАЮТСЯ намеренно: файлы и realtime живут по claim'у токена,
// заголовка не видят, и «привязанный» клиент к ним обещал бы то, чего не
// делает.
//
// ГЛАВНАЯ ОПАСНОСТЬ — НЕ ЧУЖАЯ ОПЕРАЦИЯ, А СВОЯ. Обёртки кэша зовут выгрузку
// офлайн-очереди тем клиентом, который им дали. Гейт очереди сверяет операцию
// с активной компанией и СВОЮ честно пропускает — а уедет она под заголовком
// B. Вставку сервер отобьёт по `with check`; удаление вернёт ноль строк, и с
// прошлой ночи это читается как «удалять нечего» — операция снимется с
// очереди, работа пропадёт молча. Поэтому привязанный клиент ОБЪЯВЛЯЕТ себя
// полем `BOUND_TENANT_FIELD`, и выгрузка через него не работает вовсе — это
// проверяет сама очередь (`sync/replayer.ts`), а не договорённость.
//
// Образец шима — `pagingClient()` в `features/calendar/queries.ts`: тот же
// приём «объект под видом клиента, всё немоделируемое бросает».

type DbSupabase = SupabaseClient<Database>;

/** Всё, чего у привязанного вида нет, бросает ясной ошибкой, а не
 *  `undefined is not a function` тремя вызовами ниже. */
function refuse(property: string): never {
  throw new Error(
    `bindTenant: у привязанного клиента нет "${property}" — только from и rpc. ` +
      "Файлы, realtime и сессия живут по токену, привязать их к компании нельзя.",
  );
}

/** Вид на клиент, у которого каждый запрос называет компанию `tenantId`. */
export function bindTenant(base: DbSupabase, tenantId: string): DbSupabase {
  const bound = {
    [BOUND_TENANT_FIELD]: tenantId,
    from: (table: string) => {
      const builder = base.from(table as never);
      // У `PostgrestQueryBuilder` поле `headers` открыто и копируется в каждый
      // фильтр-билдер, который он порождает: `select/insert/update/delete`.
      builder.headers.set(TENANT_HEADER, tenantId);
      return builder;
    },
    rpc: (fn: string, args?: unknown, options?: unknown) =>
      (base.rpc as (f: string, a?: unknown, o?: unknown) => { setHeader: (n: string, v: string) => unknown })(
        fn,
        args,
        options,
      ).setHeader(TENANT_HEADER, tenantId),
  };

  return new Proxy(bound, {
    get(target, property) {
      if (property in target) return target[property as keyof typeof target];
      if (typeof property === "symbol") return undefined;
      return refuse(String(property));
    },
  }) as unknown as DbSupabase;
}
