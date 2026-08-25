// Аргументы RPC, в которых NULL — законное значение.
//
// Генератор типов Supabase не различает «параметр обязателен» и «параметр не
// принимает NULL»: параметр без DEFAULT он объявляет обычной строкой, хотя в
// SQL `p_client_id uuid` спокойно принимает null — счёт без команды, платёж
// без комментария, инвойс без записи. Раньше пробел латали правкой самого
// сгенерированного файла, и правка исчезала при каждой перегенерации вместе
// с честным ответом сервера. Теперь он описан ОДИН раз и переживает
// `supabase gen types`.
//
// Ключи и типы значений по-прежнему проверяются: расширяется только
// допустимость null, необязательные параметры остаются необязательными.

import type { Database } from "./database.types";

type Functions = Database["public"]["Functions"];

export function rpcArgs<Name extends keyof Functions>(args: {
  [K in keyof Functions[Name]["Args"]]: Functions[Name]["Args"][K] | null;
}): Functions[Name]["Args"] {
  return args as Functions[Name]["Args"];
}
