// КЭШ, НАБРАННЫЙ ЧУЖИМИ ГЛАЗАМИ.
//
// В режиме зеркала вкладка «Клиенты» считает компанию чужой (иначе уровни
// клиентов не действовали бы — владелец ведь владелец), и ключи кэша выходят
// с видом `member:<id>`. Строки под ними приехали по токену ВЛАДЕЛЬЦА:
// контакты и деньги в них НАСТОЯЩИЕ, спрятаны они были только на показ
// (`select` кэш не меняет). После выхода из режима им лежать незачем.
//
// Правило — чистая функция, потому что ключи строят три разных билдера и
// формы у них разные: у списка вид третий элемент, у карточки — четвёртый.
// Первая версия знала только список, и карточка каждого открытого клиента
// оставалась в памяти на сутки (`gcTime`).

/** Ключ, заведённый зеркалом: его после выхода из режима стирают. */
export function isMirrorClientKey(key: readonly unknown[]): boolean {
  const head = key[0];
  // Набор клиентов зеркала (`use-mirror-client-scope.ts`) живёт только в режиме.
  if (head === "mirror-client-scope") return true;
  // История записей, прочитанная в режиме токеном владельца (`use-member-history.ts`).
  if (head === "member-client-history") return key[3] === "mirror";
  // ["clients", tenantId, view] и ["client-tags", tenantId, view]
  if (head === "clients" || head === "client-tags") return isMemberView(key[2]);
  // ["client", id, tenantId, view]
  if (head === "client") return isMemberView(key[3]);
  return false;
}

function isMemberView(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("member:");
}
