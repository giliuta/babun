import type { Client, ClientMembership } from "@babun/shared/local/clients";

// ─── ЧИСТОЕ ЯДРО: НАЧАЛО ───────────────────────────────────────────────
//
// Всё между метками не знает ни react, ни сети и не зовёт НИ ОДНОГО ввезённого
// значения (типы стираются). Метки — не украшение: сторож `link-writer.test.ts`
// вырезает по ним копию и проверяет ядро вызовом, а не текстом. Живой слой
// (сам хук) в bun не поднимается — он тянет `react-native`. Передвинул метку
// или ввёз в ядро значение — сторож упадёт, и это правильный отказ.

/** Куда привязываем человека: чья карточка, кем он в ней и где именно. */
export interface LinkTarget {
  groupId: string;
  role: string;
  /** Объект карточки-группы («Вилла 5»); нет — связь без места, это законно. */
  locationId?: string | null;
}

/** Адрес ОДНОЙ связи: чья строка правится, в какую карточку и в каком месте.
 *  Человека мало — один Иван законно жилец двух вилл одной управляющей и
 *  входит в карточки Натальи и Марии, и это разные связи. */
export interface LinkRef {
  memberId: string;
  groupId: string;
  locationId: string | null;
}

/** Разделитель ключа связи. Ни в одном uuid его нет, поэтому разбор обратно
 *  однозначен; «места нет» — пустой хвост, а не отсутствие части. */
const LINK_KEY_SEPARATOR = "|";

/** КЛЮЧ СТРОКИ СВЯЗИ — `человек|карточка|место`, ОДИН построитель на продукт.
 *
 *  Страница читает из ключа, КОГО открыть по тапу и ГДЕ он живёт (жильцы
 *  виллы), писатель — какую связь править. Поэтому ключ собирает и разбирает
 *  только этот файл: второй разборщик разошёлся бы с ним молча — перечень под
 *  виллой опустел бы, а тап по строке увёл бы в «Клиент не найден».
 *
 *  Карточка в ключе обязательна, хотя все строки перечня из одной: без неё
 *  писатель угадывал бы группу по кэшу и однажды попал бы не в ту — связь без
 *  места у Ивана есть и у Натальи, и у Марии, и обе карточки бывают открыты. */
export function linkKeyOf(ref: LinkRef): string {
  return [ref.memberId, ref.groupId, ref.locationId ?? ""].join(LINK_KEY_SEPARATOR);
}

/** Обратный разбор ключа строки. `null` — ключ не наш: писать по нему нельзя,
 *  потому что непонятно, чью связь править. */
export function parseLinkKey(key: string): LinkRef | null {
  const parts = key.split(LINK_KEY_SEPARATOR);
  if (parts.length !== 3) return null;
  const [memberId, groupId, locationId] = parts;
  if (!memberId || !groupId) return null;
  return { memberId, groupId, locationId: locationId || null };
}

/** КЛЮЧ ЛЮДЕЙ КАРТОЧКИ — ОДИН НА ЧИТАТЕЛЯ И ПИСАТЕЛЯ.
 *
 *  Писатель обязан бить ИМЕННО по нему: инвалидация `["client", memberId]`
 *  блок не кормит, и добавленная строка не появилась бы до рефетча. Ключ
 *  несёт компанию — карточка чужой компании читается своим клиентом и своим
 *  набором (`clientFor`), и мешать их в одном ключе нельзя. */
export function clientMembersQueryKey(
  tenantId: string | null,
  groupId: string | null,
) {
  return ["client-members", tenantId, groupId] as const;
}

/** Одна форма связи на запись: три ключа, «места нет» — это `null`, чужих
 *  ключей нет. Сервер собирает ровно эти три (триггер `clients_links`), и
 *  отправлять ему что-то ещё значит спорить с ним впустую. */
function oneShape(m: ClientMembership): ClientMembership {
  return {
    group_id: m.group_id,
    role: m.role ?? "",
    location_id: m.location_id ?? null,
  };
}

function isLink(m: ClientMembership, groupId: string, locationId: string | null): boolean {
  return m.group_id === groupId && (m.location_id ?? null) === locationId;
}

/** СВЯЗЬ ЭТОГО ЧЕЛОВЕКА ПОСЛЕ ДОБАВЛЕНИЯ. `null` — писать нечего.
 *
 *  Связь без места ДОЗАПОЛНЯЕТСЯ местом, а не дублируется: жена, которую
 *  поселили в Вилле 5, остаётся одной строкой в блоке, а не двумя. Вписанную
 *  руками роль дверь при этом не переписывает — «жена» и живёт в Вилле 5;
 *  пустую роль заполняет тем, что решила дверь («жилец»). */
export function membershipsWithLink(
  prev: readonly ClientMembership[],
  target: LinkTarget,
  memberId: string,
): ClientMembership[] | null {
  const { groupId } = target;
  const place = target.locationId ?? null;
  const role = target.role.trim();
  // Круг из одной карточки: человек не входит сам в себя. Сервер это тоже
  // ловит, но отказом всей правки, а здесь просто нечего писать.
  if (!groupId || !memberId || groupId === memberId) return null;
  // Ровно такая связь уже стоит — второй строки из неё не делаем.
  if (prev.some((m) => isLink(m, groupId, place))) return null;

  const next = prev.map(oneShape);
  const placeless = place
    ? next.findIndex((m) => isLink(m, groupId, null))
    : -1;
  if (placeless >= 0) {
    next[placeless] = {
      group_id: groupId,
      role: next[placeless].role.trim() || role,
      location_id: place,
    };
    return next;
  }
  return [...next, { group_id: groupId, role, location_id: place }];
}

/** СВЯЗЬ ПОСЛЕ ПРАВКИ РОЛИ. `null` — писать нечего.
 *
 *  ЕСЛИ СВЯЗИ В СВЕЖЕЙ СТРОКЕ НЕТ — НЕ ПИШЕМ НИЧЕГО (дыра 7 критика). Роль
 *  коммитится в том числе на размонтировании строки, а строка размонтируется
 *  и тогда, когда связь только что убрали: запись роли воскресила бы её.
 *  `LinkRow.shouldCommitRoleOnUnmount` стережёт это со стороны разметки, здесь
 *  — парная защита со стороны данных: два разных пути, одна потеря. */
export function membershipsWithRole(
  prev: readonly ClientMembership[],
  ref: LinkRef,
  role: string,
): ClientMembership[] | null {
  const wanted = role.trim();
  const at = prev.findIndex((m) => isLink(m, ref.groupId, ref.locationId));
  if (at < 0) return null;
  if ((prev[at].role ?? "").trim() === wanted) return null;
  const next = prev.map(oneShape);
  next[at] = { ...next[at], role: wanted };
  return next;
}

/** СВЯЗЬ ПОСЛЕ СНЯТИЯ. `null` — такой связи в строке нет, писать нечего:
 *  повторный «Убрать» (второй тап, вернувшийся откат) не должен переписывать
 *  массив и трогать соседние связи этого человека. */
export function membershipsWithoutLink(
  prev: readonly ClientMembership[],
  ref: LinkRef,
): ClientMembership[] | null {
  const kept = prev.filter((m) => !isLink(m, ref.groupId, ref.locationId));
  if (kept.length === prev.length) return null;
  return kept.map(oneShape);
}

/** Очередь записей ОДНОГО человека: его свежая правда и цепочка. */
export interface LinkQueue {
  /** Наш ещё не подтверждённый массив. `null` — верить строке. */
  latest: ClientMembership[] | null;
  /** Сколько наших записей в пути. */
  pending: number;
  /** Вторая запись уходит после ответа на первую. */
  chain: Promise<unknown>;
}

/** Очереди — МОДУЛЬНЫЕ, одна карта на процесс (правило 2 в шапке). */
const queues = new Map<string, LinkQueue>();

export function linkQueueFor(memberId: string): LinkQueue {
  const found = queues.get(memberId);
  if (found) return found;
  const fresh: LinkQueue = { latest: null, pending: 0, chain: Promise.resolve() };
  queues.set(memberId, fresh);
  return fresh;
}

/** СВЕЖИЕ СВЯЗИ ЧЕЛОВЕКА: наша неподтверждённая правда, пока хоть одна наша
 *  запись в пути, иначе строка. Рендер приносит авторитетное значение (в том
 *  числе чужую правку), но верить ему можно только между своими записями:
 *  чтение, запущенное инвалидацией первой записи, отвечает на медленной сети
 *  ПОСЛЕ второй и приносит массив без неё. */
export function freshLinks(
  queue: LinkQueue,
  row: readonly ClientMembership[],
): ClientMembership[] {
  if (queue.pending > 0 && queue.latest) return queue.latest;
  return [...row];
}

/** Порядок сервера — `order by c.full_name, c.id`. Точный порядок приезжает с
 *  ответом; здесь он нужен, чтобы строка встала НЕ В КОНЕЦ до него. */
function goesBefore(
  row: Pick<Client, "id" | "full_name">,
  other: Pick<Client, "id" | "full_name">,
): boolean {
  const a = row.full_name.trim();
  const b = other.full_name.trim();
  if (a !== b) return a < b;
  return row.id < other.id;
}

/** ПЕРЕЧЕНЬ ЛЮДЕЙ КАРТОЧКИ ПОСЛЕ ЗАПИСИ — до ответа сервера.
 *
 *  Одна функция на все три действия: строка встаёт (в связи есть эта группа),
 *  уходит (не осталось) или переписывается (сменились роль или место). Карточка
 *  ни при чём — возвращается ТОТ ЖЕ массив: писатель по нему и понимает, какие
 *  ключи он тронул, а какие обошёл (переселение трогает две группы). */
export function membersAfterWrite(
  rows: readonly Client[],
  member: Client,
  next: readonly ClientMembership[],
  groupId: string,
): readonly Client[] {
  const had = rows.some((row) => row.id === member.id);
  const stays = next.some((m) => m.group_id === groupId);
  if (!had && !stays) return rows;
  const rest = rows.filter((row) => row.id !== member.id);
  if (!stays) return rest;
  const row: Client = { ...member, memberships: next.map(oneShape) };
  const at = rest.findIndex((other) => goesBefore(row, other));
  return at < 0 ? [...rest, row] : [...rest.slice(0, at), row, ...rest.slice(at)];
}

// ─── ЧИСТОЕ ЯДРО: КОНЕЦ ────────────────────────────────────────────────
