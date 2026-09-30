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
  // ["clients", tenantId, view] и ["client-tags", tenantId, view]
  if (head === "clients" || head === "client-tags") return isMemberView(key[2]);
  // ["client", id, tenantId, view]
  if (head === "client") return isMemberView(key[3]);
  return false;
}

function isMemberView(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("member:");
}
