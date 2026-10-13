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
import { clientKeys } from "@/features/clients/query-keys";
import {
  clientMembersQueryKey,
  freshLinks,
  linkQueueFor,
  membersAfterWrite,
  membershipsWithLink,
  membershipsWithoutLink,
  membershipsWithRole,
  parseLinkKey,
  type LinkRef,
  type LinkTarget,
} from "./use-link-writer/core";

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
//
// The pure core (keys, membership math, queues) lives in
// `./use-link-writer/core`; this file is the live hook.

export {
  clientMembersQueryKey,
  freshLinks,
  linkKeyOf,
  linkQueueFor,
  membersAfterWrite,
  membershipsWithLink,
  membershipsWithoutLink,
  membershipsWithRole,
  parseLinkKey,
  type LinkQueue,
  type LinkRef,
  type LinkTarget,
} from "./use-link-writer/core";

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

/** Строка человека в момент «Убрать» — для «Отменить». После снятия связи
 *  его может не быть ни в одном кэше экрана, и возврат не находил строку. */
const detachedRows = new Map<string, Client>();

/** СВЕЖАЯ СТРОКА ЧЛЕНА — только оттуда, где связи ЕСТЬ.
 *
 *  Сначала его собственная карточка (`["client", memberId]` — её же патчит
 *  оптимистично сама мутация), потом любой перечень людей: обе дороги идут
 *  через `rowToClient`, который заполняет `memberships`. Списка мастера
 *  (`list_master_clients_safe`) среди них нет намеренно: он связей не отдаёт
 *  вовсе, и первая же запись от него стёрла бы все связи человека — поэтому у
 *  такого источника блока связей нет (`caps.links`). */
function freshMemberRow(
  qc: QueryClient,
  memberId: string,
  tenantId: string | null,
): Client | null {
  for (const [, value] of qc.getQueriesData<Client | null>({ queryKey: clientKeys.card(memberId) })) {
    if (value && value.id === memberId) return value;
  }
  for (const [, rows] of qc.getQueriesData<Client[]>({
    queryKey: clientKeys.membersOfTenant(tenantId),
  })) {
    const found = Array.isArray(rows) ? rows.find((row) => row.id === memberId) : undefined;
    if (found) return found;
  }
  // Общий список клиентов. После «Убрать» человека уже нет в перечне
  // карточки-группы, и «Отменить» не находило его строку — связь молча не
  // возвращалась (снято 23.09 на симуляторе).
  for (const [, rows] of qc.getQueriesData<Client[]>({ queryKey: clientKeys.all() })) {
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
        queryKey: clientKeys.membersOfTenant(tenantId),
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
