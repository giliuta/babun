// СВЯЗИ КЛИЕНТОВ — ЧИСТЫЕ ВЫБОРКИ И ОДНА СТРОКА ПОКАЗА (STORY-086).
//
// Связь живёт У ЧЛЕНА: `clients.memberships = [{ group_id, role, location_id? }]`.
// Отсюда ровно три вопроса и три выборки:
//   «люди карточки X»   → clientPeople
//   «жильцы объекта L»  → residentsOf
//   «чей он сам»        → clientMemberOf
//
// Ни React, ни сети: одни и те же функции считают строку на устройстве, в
// офлайн-фолбэке и в тестах. Хук поверх них только приносит данные.
//
// Строку показа собирает ОДИН построитель — `linkLine`, на все три места, где
// связь видно: `MemberOfLine` (по строке на связь), `ClientRow.link` и
// `linkFor` в шторке выбора. Второй построитель разошёлся бы с первым в
// первый же день — так в продукте уже выросли три высоты строки списка.

import type { Client, ClientMembership, Location } from "../clients";
import { clientMemberships } from "../clients";

/** Что нужно от карточки-группы, чтобы назвать связь словами: имя и места.
 *  Уже, чем `Client`, намеренно — строку собирают и из урезанного окна
 *  сервера, где всей карточки нет. */
export type LinkGroup = Pick<Client, "id" | "full_name" | "locations">;

/** Разобранная связь: чем она была в jsonb и на что указывает сейчас. */
export interface ClientMemberOf {
  /** Карточка, в которую он входит. */
  groupId: string;
  /** Кем приходится, своими словами: «жена», «жилец». Пусто — роли нет. */
  role: string;
  /** Место внутри карточки-группы; `null` — связь без места. */
  locationId: string | null;
  /** Карточка-группа, если читателю её видно. `null` — не видно или стёрта:
   *  связь есть, а имени для строки взять неоткуда. */
  group: LinkGroup | null;
  /** Место, если оно ЕЩЁ есть у группы. `null` — места нет или исчезло:
   *  сервер чистит `location_id` только при правке связей самого члена, и до
   *  неё id стёртой виллы живёт в строке (STORY-086, дыра 12). */
  location: Location | null;
}

/** Одна строка связи, разобранная на части и собранная целиком.
 *  Части нужны `MemberOfLine` (роль серым, чей — акцентом), целая строка —
 *  `ClientRow.link` и `linkFor`, которые берут одну строку текста. */
export interface LinkLine {
  /** Роль первой связи: «жилец». Пусто — роли нет. */
  role: string;
  /** Чья карточка: «Наталья». Никогда не пусто — безымянная связь не строка. */
  name: string;
  /** Место внутри карточки: «Вилла 5». Пусто — связи без места или место исчезло. */
  place: string;
  /** Сколько связей НЕ вошло в строку. 0 — она единственная. */
  rest: number;
  /** Вся строка одним текстом: «жилец · Наталья · Вилла 5 +1». */
  text: string;
}

/** Место связи одним видом: ключа нет, `null` — всё это «без места». */
function placeIdOf(m: ClientMembership): string | null {
  return m.location_id ?? null;
}

function membershipIn(
  client: Pick<Client, "memberships">,
  groupId: string,
): ClientMembership | undefined {
  return clientMemberships(client).find((m) => m.group_id === groupId);
}

/** Карта карточек по id — вход для `clientMemberOf`. Отдельной функцией,
 *  чтобы каждый экран не писал свою сборку и не терял дубликаты id. */
export function clientsById<T extends Pick<Client, "id">>(
  clients: readonly T[],
): Map<string, T> {
  const map = new Map<string, T>();
  for (const c of clients) map.set(c.id, c);
  return map;
}

/** ЛЮДИ КАРТОЧКИ: клиенты, у кого в `memberships` стоит эта карточка.
 *
 *  Порядок входной — список уже отсортирован тем, кто его принёс (сервер или
 *  кэш); своей сортировки здесь нет, иначе она разойдётся со списком клиентов.
 *  Ничего не фильтрует по архиву: набор выбирает вызывающий. */
export function clientPeople<T extends Pick<Client, "memberships">>(
  clients: readonly T[],
  groupId: string,
): T[] {
  if (!groupId) return [];
  return clients.filter((c) => membershipIn(c, groupId) !== undefined);
}

/** ЖИЛЬЦЫ ОБЪЕКТА: люди карточки, чья связь названа ИМЕННО этим местом.
 *
 *  Связь без места жильцом не делает: жена и управляющая входят в ту же
 *  карточку, и показывать их под «Виллой 5» — врать про то, кто там живёт. */
export function residentsOf<T extends Pick<Client, "memberships">>(
  clients: readonly T[],
  groupId: string,
  locationId: string,
): T[] {
  if (!groupId || !locationId) return [];
  return clients.filter((c) =>
    clientMemberships(c).some(
      (m) => m.group_id === groupId && placeIdOf(m) === locationId,
    ),
  );
}

/** ЧЕЙ ОН САМ: его связи, разобранные до карточки и места.
 *
 *  Порядок связей сохраняется: первая в массиве — первая на экране и первая
 *  в однострочных местах. Нечитаемая карточка не выбрасывается, а приезжает
 *  с `group: null` — вызывающий должен видеть, что связь есть, даже когда
 *  назвать её нечем. */
export function clientMemberOf(
  client: Pick<Client, "memberships">,
  byId: ReadonlyMap<string, LinkGroup>,
): ClientMemberOf[] {
  return clientMemberships(client).map((m) => {
    const group = byId.get(m.group_id) ?? null;
    const locationId = placeIdOf(m);
    const location =
      group && locationId
        ? (group.locations ?? []).find((l) => l.id === locationId) ?? null
        : null;
    return {
      groupId: m.group_id,
      role: m.role.trim(),
      locationId,
      group,
      location,
    };
  });
}

/** Как объект называется в строке. Тот же порядок, что в блоке «Объекты»
 *  (`loc.label || "Объект"`), плюс адрес между ними: безымянный объект всё
 *  равно ЕСТЬ, и молчать о нём нельзя — молчание здесь означает «место
 *  исчезло». */
function placeName(location: Location): string {
  // БЕЗ ТИПА — ПЕРВАЯ ЧАСТЬ АДРЕСА, А НЕ ВЕСЬ АДРЕС (прогон 22.09): в строке
  // человека «Илья · Villa 5, Agiou Tychona, Li… · жилец» полный адрес
  // обрезался и выдавливал роль. Первая часть до запятой — это и есть то, как
  // место называют вслух: «Villa 5», «Agiou Tychona 5».
  const head = location.address.split(",")[0]?.trim() ?? "";
  return location.label.trim() || head || location.address.trim() || "Объект";
}

/** ОДНА СТРОКА СВЯЗИ — «жилец · Наталья · Вилла 5».
 *
 *  Роль стоит ПЕРВОЙ: это роль ЭТОГО человека, а за точкой — чей он
 *  (`MemberOfLine`: «Павел Иванов · жена» читалось наоборот).
 *
 *  Связь, которую нечем назвать (карточка не видна читателю или стёрта), в
 *  строку не идёт вовсе: «жилец · (никого)» — запрещённое третье состояние
 *  «видно, но пусто». Если назвать нечего ни одну — строки нет.
 *
 *  Нескольких членств одна строка не вмещает (владелец видит полный перечень
 *  на карточке), поэтому берётся ПЕРВАЯ, а остальные считаются хвостом
 *  « +N» — решение по дыре 14. Место вмещает первая же строка: жилец двух
 *  вилл одной управляющей — это две связи, а не одна с двумя местами.
 *
 *  `MemberOfLine` зовёт этот же построитель по одной связи (`linkLine([e])`),
 *  и хвоста у него не возникает — одна функция на все три места показа. */
export function linkLine(entries: readonly ClientMemberOf[]): LinkLine | null {
  const named = entries.filter(
    (e) => e.group !== null && e.group.full_name.trim() !== "",
  );
  const first = named[0];
  if (!first || !first.group) return null;

  const role = first.role;
  const name = first.group.full_name.trim();
  const place = first.location ? placeName(first.location) : "";
  const rest = named.length - 1;
  const text =
    [role, name, place].filter((p) => p !== "").join(" · ") +
    (rest > 0 ? ` +${rest}` : "");

  return { role, name, place, rest, text };
}
