import { useCallback, useMemo, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  clientMemberships,
  type Client,
  type ClientMembership,
} from "@babun/shared/local/clients";
import { capabilitiesOf } from "./clients-company";
import { useClientsSourceScope, useUpdateClientById } from "./queries";
import type { ClientLinkItem } from "./blocks/ClientLinksBlock";

// ПИСАТЕЛЬ СВЯЗЕЙ (STORY-086).
//
// Связь живёт У ЧЛЕНА (`clients.memberships`), поэтому ЛЮБОЕ действие в блоке
// «Люди» карточки Павла — это патч по строке ЕКАТЕРИНЫ. Отсюда три правила,
// каждое куплено разбором конкретной потери:
//
//   1. ПАТЧ СОБИРАЕТСЯ ИЗ СВЕЖЕЙ СТРОКИ ЧЛЕНА, а не из замыкания рендера:
//      массив `memberships` перезаписывается ЦЕЛИКОМ, и снимок кадра затёр бы
//      связь, добавленную секунду назад (та же цена, что у `phones` и
//      `locations` — разбор в `use-json-writer.ts`).
//   2. ОЧЕРЕДЬ — МОДУЛЬНАЯ КАРТА ПО `memberId`, одна на процесс. `useJsonArrayWriter`
//      здесь не годится: он однохозяйный (`ownerKey` обнуляет очередь при смене
//      хозяина), а Иван законно жилец и Натальи, и Марии — обе карточки бывают
//      открыты, и две независимые очереди на ОДИН его массив молча стёрли бы
//      связь другой группы (образец общего на процесс правила — `closeOpenRow`
//      в `SwipeRow.tsx`).
//   3. СТРОКА ПОЯВЛЯЕТСЯ И ИСЧЕЗАЕТ ДО ОТВЕТА СЕРВЕРА — в том самом ключе,
//      который кормит блок (`["client-members", tenantId, groupId]`). Иначе
//      обещанный «курсор сразу в роли» фокусировать нечего, а «переселение»
//      трогает две группы, ни одна из которых не названа.
//
// Ошибка записи откатывает и оптимистичную строку, и «свежую правду» очереди:
// фантом, оставшийся в `latest`, уехал бы в базу со СЛЕДУЮЩЕЙ удачной записью.

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

/** Что умеет писатель связей. Возвращают `true`, когда правда в базе стала
 *  той, какой её хотели (в том числе когда писать было нечего). */
export interface LinkWriter {
  attach(member: Client, target: LinkTarget): Promise<boolean>;
  setRole(item: ClientLinkItem, role: string): Promise<boolean>;
  detach(item: ClientLinkItem): Promise<boolean>;
  /** Вернуть только что убранную связь — «Отменить» в подсказке после
   *  свайпа (23.09): убираем без вопроса, но ошибку пальца можно откатить. */
  restore(item: ClientLinkItem): Promise<boolean>;
}

/** СВЕЖАЯ СТРОКА ЧЛЕНА — только оттуда, где связи ЕСТЬ.
 *
 *  Сначала его собственная карточка (`["client", memberId]` — её же патчит
 *  оптимистично сама мутация), потом любой перечень людей: обе дороги идут
 *  через `rowToClient`, который заполняет `memberships`. Списка мастера
 *  (`list_master_clients_safe`) среди них нет намеренно: он связей не отдаёт
 *  вовсе, и первая же запись от него стёрла бы все связи человека — поэтому у
 *  такого источника блока связей нет (`caps.links`). */
/** Строка человека в момент «Убрать» — для «Отменить». После снятия связи
 *  его может не быть ни в одном кэше экрана, и возврат не находил строку. */
const detachedRows = new Map<string, Client>();

function freshMemberRow(
  qc: QueryClient,
  memberId: string,
  tenantId: string | null,
): Client | null {
  for (const [, value] of qc.getQueriesData<Client | null>({ queryKey: ["client", memberId] })) {
    if (value && value.id === memberId) return value;
  }
  for (const [, rows] of qc.getQueriesData<Client[]>({
    queryKey: ["client-members", tenantId],
  })) {
    const found = Array.isArray(rows) ? rows.find((row) => row.id === memberId) : undefined;
    if (found) return found;
  }
  // Общий список клиентов. После «Убрать» человека уже нет в перечне
  // карточки-группы, и «Отменить» не находило его строку — связь молча не
  // возвращалась (снято 23.09 на симуляторе).
  for (const [, rows] of qc.getQueriesData<Client[]>({ queryKey: ["clients"] })) {
    const found = Array.isArray(rows) ? rows.find((row) => row?.id === memberId) : undefined;
    if (found) return found;
  }
  return null;
}

/** Адрес строки для записи. Чужой ключ — ошибка вызывающего, а не данные:
 *  молчаливый отказ потерял бы правку без следа, поэтому в разработке он
 *  говорит вслух. */
function addressOf(item: ClientLinkItem): LinkRef | null {
  const ref = parseLinkKey(item.key);
  if (!ref && __DEV__) {
    console.warn(
      `useLinkWriter: ключ «${item.key}» собран не linkKeyOf — строки перечня берутся из useClientMembers.`,
    );
  }
  return ref;
}

export function useLinkWriter(): LinkWriter {
  const qc = useQueryClient();
  const update = useUpdateClientById();
  const scope = useClientsSourceScope();
  // Живые значения — через ref: сам писатель отдаётся наружу стабильными
  // функциями (их кладут в зависимости эффектов и в обработчики строк), а
  // записи доживают дольше кадра, в котором их позвали.
  const caps = scope ? capabilitiesOf(scope) : null;
  const now = {
    mutate: update.mutateAsync,
    tenantId: scope?.tenantId ?? null,
    // Писать связи можно там, где блок людей вообще стоит, и только правом
    // «Меняет»: у «Смотрит» роли читаются, а свайпа и двери нет.
    allowed: !!caps && caps.links && caps.edit,
  };
  const live = useRef(now);
  live.current = now;

  /** Одна запись связей человека: `base` — от чего считали, `next` — что
   *  пишем, `groupId` — карточка, в чьём перечне сделано действие. */
  const writeLinks = useCallback(
    async (
      member: Client,
      base: ClientMembership[],
      next: ClientMembership[],
      groupId: string,
    ): Promise<boolean> => {
      const { mutate, tenantId, allowed } = live.current;
      if (!allowed || !tenantId) return false;
      const queue = linkQueueFor(member.id);
      const previous = queue.latest;
      queue.latest = next;
      queue.pending += 1;

      // Оптимистично — ПО ВСЕМ перечням людей, какие лежат в кэше: одна
      // запись меняет строку человека сразу в двух группах, когда его
      // переселяют, и ни одна из них не должна ждать рефетча.
      const touched = new Set<string>([groupId]);
      for (const [key, rows] of qc.getQueriesData<Client[]>({
        queryKey: ["client-members", tenantId],
      })) {
        const listGroup = key[2];
        if (typeof listGroup !== "string" || !Array.isArray(rows)) continue;
        const after = membersAfterWrite(rows, member, next, listGroup);
        if (after === rows) continue;
        touched.add(listGroup);
        qc.setQueryData(key, after);
      }
      // Последнее слово — у сервера: место, которого нет у группы, он
      // обнуляет, оставляя связь живой, а ключ строки собран из места. Роль
      // перечитывается тоже — она пишется по уходу с поля, и строку под
      // курсором рефетч не трогает (`LinkRow` держит набранное, пока его правят).
      const refetchTouched = () => {
        for (const g of touched) {
          void qc.invalidateQueries({ queryKey: clientMembersQueryKey(tenantId, g) });
        }
      };

      const settle = () => {
        queue.pending = Math.max(0, queue.pending - 1);
      };
      const run = queue.chain
        .then(() => mutate({ id: member.id, patch: { memberships: next } }))
        .then(
          () => {
            settle();
            refetchTouched();
            return true;
          },
          () => {
            // ОТКАТ — ТОЛЬКО СВОЕЙ СТРОКИ И ТОЛЬКО ЕСЛИ ПОВЕРХ НЕ ВСТАЛО НОВОЕ.
            // Снимок перечня целиком здесь не годится: в нём уже могут стоять
            // чужие строки, добавленные после нас, и возврат снимка стёр бы их.
            // Поэтому строка ЭТОГО человека возвращается к тому, от чего
            // считали (`base`). Более новая запись этого же человека уже несёт
            // свою правду — её не трогаем.
            if (queue.latest === next) {
              queue.latest = previous;
              for (const g of touched) {
                const key = clientMembersQueryKey(tenantId, g);
                const rows = qc.getQueryData<Client[]>(key);
                if (rows) qc.setQueryData(key, membersAfterWrite(rows, member, base, g));
              }
            }
            settle();
            refetchTouched();
            return false;
          },
        );
      queue.chain = run;
      return run;
    },
    [qc],
  );

  const attach = useCallback(
    async (member: Client, target: LinkTarget): Promise<boolean> => {
      const { tenantId, allowed } = live.current;
      if (!allowed || !tenantId) return false;
      const row = freshMemberRow(qc, member.id, tenantId) ?? member;
      const queue = linkQueueFor(member.id);
      const base = freshLinks(queue, clientMemberships(row));
      const next = membershipsWithLink(base, target, member.id);
      if (!next) {
        // Такая связь уже стоит — писать нечего. Перечень всё равно
        // перечитываем: раз человека выбрали, значит строки его не было
        // видно, и она обязана появиться.
        void qc.invalidateQueries({ queryKey: clientMembersQueryKey(tenantId, target.groupId) });
        return true;
      }
      return writeLinks(row, base, next, target.groupId);
    },
    [qc, writeLinks],
  );

  const setRole = useCallback(
    async (item: ClientLinkItem, role: string): Promise<boolean> => {
      const { tenantId, allowed } = live.current;
      const ref = addressOf(item);
      if (!allowed || !tenantId || !ref) return false;
      const row = freshMemberRow(qc, ref.memberId, tenantId);
      // Строки члена нет ни в одном перечне — собирать патч не из чего, а из
      // строки самого блока собрать нельзя: в ней только эта связь, и запись
      // стёрла бы остальные.
      if (!row) return false;
      const queue = linkQueueFor(ref.memberId);
      const base = freshLinks(queue, clientMemberships(row));
      const next = membershipsWithRole(base, ref, role);
      // Связи нет (убрали, пока строка уходила) или роль та же — не пишем.
      if (!next) return true;
      return writeLinks(row, base, next, ref.groupId);
    },
    [qc, writeLinks],
  );

  const detach = useCallback(
    async (item: ClientLinkItem): Promise<boolean> => {
      const { tenantId, allowed } = live.current;
      const ref = addressOf(item);
      if (!allowed || !tenantId || !ref) return false;
      const row = freshMemberRow(qc, ref.memberId, tenantId);
      if (!row) return false;
      const queue = linkQueueFor(ref.memberId);
      const base = freshLinks(queue, clientMemberships(row));
      const next = membershipsWithoutLink(base, ref);
      if (!next) return true;
      detachedRows.set(ref.memberId, row);
      return writeLinks(row, base, next, ref.groupId);
    },
    [qc, writeLinks],
  );

  const restore = useCallback(
    async (item: ClientLinkItem): Promise<boolean> => {
      const { tenantId, allowed } = live.current;
      const ref = addressOf(item);
      if (!allowed || !tenantId || !ref) return false;
      const row =
        freshMemberRow(qc, ref.memberId, tenantId) ?? detachedRows.get(ref.memberId) ?? null;
      if (!row) return false;
      const queue = linkQueueFor(ref.memberId);
      // ОТ ПОСЛЕДНЕЙ СВОЕЙ ЗАПИСИ, а не от строки кэша: строка ещё помнит
      // связь, которую только что убрали, — «уже есть, писать нечего», и
      // «Отменить» молча ничего не делало (снято 23.09 на симуляторе).
      const base = queue.latest ? [...queue.latest] : freshLinks(queue, clientMemberships(row));
      const next = membershipsWithLink(
        base,
        { groupId: ref.groupId, role: item.role, locationId: ref.locationId },
        ref.memberId,
      );
      if (!next) return true;
      return writeLinks(row, base, next, ref.groupId);
    },
    [qc, writeLinks],
  );

  return useMemo(
    () => ({ attach, setRole, detach, restore }),
    [attach, setRole, detach, restore],
  );
}
