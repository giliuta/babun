import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { clientMemberships, type Client } from "@babun/shared/local/clients";
import {
  clientMemberOf,
  clientsById,
  linkLine,
  type LinkGroup,
} from "@babun/shared/local/selectors/client-links";
import type { ClientLinkItem } from "./blocks/ClientLinksBlock";
import { capabilitiesOf } from "./clients-company";
import {
  memberClientJsonToClient,
  useClient,
  useClients,
  useClientsSourceScope,
} from "./queries";
import { clientFor } from "./sources";
import { clientMembersQueryKey, linkKeyOf } from "./use-link-writer";

// СВЯЗИ КЛИЕНТА — ЧТЕНИЕ (STORY-086).
//
// Связь живёт У ЧЛЕНА, поэтому вопросов два и дорог к ним две:
//   «люди карточки X» — чужие строки, у кого в `memberships` стоит X. Их на
//     устройстве не найти, не перебрав весь справочник, — отвечает сервер
//     (`list_client_members`, GIN по связям), одним запросом на карточку;
//   «чей он сам» — его собственная строка, второго запроса нет: карточки, в
//     которые он входит, называются по уже приехавшему списку клиентов.
//
// ТРЕТЬЕГО СОСТОЯНИЯ НЕТ. Блок либо стоит целиком, либо его НЕТ
// (`unavailable`): урезанному набору сервер отдаёт ноль строк, и показать их
// «пустым блоком» значило бы соврать, что людей нет. Строку связи, которую
// нечем назвать, `linkLine` не отдаёт вовсе — «жилец · (никого)» не строка.

/** Узкий тип вместо `any`: `database.types.ts` новой функции ещё не знает — её
 *  миграция не накачена, типы перегенерируют после наката. Тот же приём, что у
 *  `list_member_clients` в `queries.ts`. */
type RpcWithClientMembers = {
  rpc: (
    name: "list_client_members",
    args: { p_group_id: string },
  ) => PromiseLike<{
    data: unknown[] | null;
    error: { message: string; code?: string } | null;
  }>;
};

/** ФУНКЦИИ НА СЕРВЕРЕ ЕЩЁ НЕТ — связи не включены, а не «сломались».
 *
 *  До наката миграции связей `list_client_members` не существует: PostgREST
 *  отвечает `PGRST202` («функция не найдена»), сам Postgres — `42883`. Раньше
 *  это читалось ошибкой, и КАЖДАЯ карточка клиента показывала строку «Люди
 *  карточки сейчас не загрузились» — на экране владельца, у всех клиентов
 *  разом (22.09). Отсутствующая функция — это не сбой сети, а выключенная
 *  возможность: блока нет, как у сотрудника без права. После наката ответ
 *  становится обычным, и блок включается сам, без выпуска приложения. */
export class LinksNotOnServer extends Error {}

const MISSING_FUNCTION = new Set(["PGRST202", "42883"]);

/** ЛЮДИ КАРТОЧКИ С СЕРВЕРА — клиентом ЕЁ компании (`clientFor`): карточка
 *  работодателя читается его набором, а не набором компании, открытой в
 *  календаре (дыра 10 критика).
 *
 *  ОШИБКА — ЭТО ОШИБКА, А НЕ «ЛЮДЕЙ НЕТ». Пока миграция не накачена, функции
 *  на сервере нет, и ответ «не найдено», прочитанный пустым списком, показал
 *  бы пустой блок у карточки, где люди есть. Пустой массив здесь значит одно:
 *  сервер ответил, и людей у карточки нет.
 *
 *  ОФЛАЙН-ФОЛБЭКА НАМЕРЕННО НЕТ. Он читал бы людей перебором справочника на
 *  устройстве — ровно то, от чего ТЗ отказалось («Что НЕ делаем», п. 10), — и
 *  без сети блок говорит словами, а не показывает снимок, который никто не
 *  сверял (дыра 11). */
async function listClientMembers(
  client: ReturnType<typeof clientFor>,
  groupId: string,
): Promise<Client[]> {
  const rpc = client as unknown as RpcWithClientMembers;
  const { data, error } = await rpc.rpc("list_client_members", { p_group_id: groupId });
  if (error) {
    if (error.code && MISSING_FUNCTION.has(error.code)) {
      throw new LinksNotOnServer(`listClientMembers: ${error.message}`);
    }
    throw new Error(`listClientMembers: ${error.message}`);
  }
  return (data ?? []).map(memberClientJsonToClient);
}

/** Строки блока из людей карточки: по строке на СВЯЗЬ (жилец двух вилл —
 *  две строки). Место называет тот же единый построитель, что строку «чей
 *  он» (`linkLine`), — второго имени виллы в продукте не появится. */
function linkItemsOf(
  members: readonly Client[],
  group: LinkGroup | null,
  groupId: string,
): ClientLinkItem[] {
  const byId = new Map<string, LinkGroup>(group ? [[group.id, group]] : []);
  const items: ClientLinkItem[] = [];
  for (const member of members) {
    for (const entry of clientMemberOf(member, byId)) {
      if (entry.groupId !== groupId) continue;
      items.push({
        // Ключ несёт весь адрес связи — по нему писатель находит, что править.
        key: linkKeyOf({ memberId: member.id, groupId, locationId: entry.locationId }),
        name: member.full_name,
        place: linkLine([entry])?.place || undefined,
        phone: member.phone_e164 || member.phone || null,
        telegramUsername: member.telegram_username || null,
        role: entry.role,
      });
    }
  }
  return items;
}

export interface ClientMembers {
  data: readonly ClientLinkItem[];
  isLoading: boolean;
  isError: boolean;
  /** Сервер набора не даёт (прав нет, набор урезан, у черновика нет id) —
   *  блока на странице НЕТ, а не «есть и пустой». */
  unavailable: boolean;
}

const NO_ITEMS: readonly ClientLinkItem[] = [];

/** Люди карточки: клиенты, у кого в memberships есть groupId. */
export function useClientMembers(groupId: string | null): ClientMembers {
  const scope = useClientsSourceScope();
  const tenantId = scope?.tenantId ?? null;
  const isActive = scope?.isActive ?? true;
  const unavailable = !groupId || !scope || !capabilitiesOf(scope).links;
  // Карточка-группа — та самая, на которой стоит блок: её строка уже в кэше
  // под тем же ключом, лишнего запроса нет. Из неё — имена мест.
  const group = useClient(!unavailable && groupId ? groupId : "");
  const query = useQuery({
    queryKey: clientMembersQueryKey(tenantId, groupId),
    enabled: !unavailable && !!tenantId,
    // БЕЗ СЕТИ — ОШИБКА СЛОВАМИ, А НЕ ПУСТОЙ БЛОК (дыра 11). По умолчанию
    // запрос без сети ставится на паузу: данных нет, ни загрузки, ни ошибки —
    // и блок нарисовался бы пустым, то есть «людей нет». Здесь запрос идёт
    // всегда и честно падает.
    networkMode: "always",
    // Функции нет — переспрашивать нечего: ответ не изменится до наката.
    retry: (count, error) => !(error instanceof LinksNotOnServer) && count < 2,
    queryFn: () => listClientMembers(clientFor(tenantId as string, isActive), groupId as string),
  });
  const members = query.data;
  const notOnServer = query.error instanceof LinksNotOnServer;
  const groupRow = group.data ?? null;
  const data = useMemo(
    () => (members && groupId ? linkItemsOf(members, groupRow, groupId) : NO_ITEMS),
    [members, groupRow, groupId],
  );
  return {
    data,
    // Ответа ещё не было — это загрузка, чем бы запрос ни был занят сейчас:
    // пустой перечень до первого ответа не значит «людей нет».
    isLoading: !unavailable && query.isPending,
    // Упавшее ПЕРЕчитывание при уже показанных людях строк не прячет: люди
    // настоящие, а слово ошибки вместо них соврало бы, что их нет.
    isError: !notOnServer && query.isError && members === undefined,
    unavailable: unavailable || notOnServer,
  };
}

/** Строка «чей он»: одна связь — одна строка. */
export type MemberOfItem = { key: string; line: string; groupId: string };

const NO_MEMBER_OF: readonly MemberOfItem[] = [];

/** Чей он сам: его собственные memberships, развёрнутые в строки показа.
 *
 *  Под тем же правом, что люди карточки (`caps.links`): сотруднику с
 *  урезанным набором связь приходит, а карточка, на которую она указывает, —
 *  нет, и строка «чей он» стояла бы там, где на самой карточке-группе блока
 *  людей нет (дыра 9). Нечитаемую связь `linkLine` и так не называет, но
 *  видимость решает право, а не случай «повезло назвать». */
export function useMemberOf(client: Client | null): {
  data: readonly MemberOfItem[];
  /** Связи у человека есть, а назвать их нечем: справочник ещё едет
   *  (`loading`) или не приехал (`failed`). Молча пустая строка на мигающей
   *  сети читалась бы как «человек ничей» — это неправда. */
  unnamed: "loading" | "failed" | null;
} {
  const scope = useClientsSourceScope();
  const allowed = !!scope && capabilitiesOf(scope).links;
  // Список клиентов на карточке уже прочитан (блок «Личное» зовёт его же),
  // поэтому имена групп берутся из него без второго запроса.
  const directoryQuery = useClients();
  const directory = directoryQuery.data;
  const data = useMemo(() => {
    if (!client || !allowed) return NO_MEMBER_OF;
    if (clientMemberships(client).length === 0) return NO_MEMBER_OF;
    const byId = clientsById(directory ?? []);
    const rows: MemberOfItem[] = [];
    for (const entry of clientMemberOf(client, byId)) {
      // По одной связи — хвоста «+N» у строки на карточке не бывает.
      const line = linkLine([entry]);
      if (!line) continue;
      rows.push({
        // Ключ — связь «куда и где»: человек здесь один, а связей у него N,
        // и в одну карточку он входит дважды, если живёт в двух её виллах.
        key: `${entry.groupId}:${entry.locationId ?? ""}`,
        line: line.text,
        groupId: entry.groupId,
      });
    }
    return rows;
  }, [client, allowed, directory]);
  const hasLinks = !!client && allowed && clientMemberships(client).length > 0;
  const unnamed =
    hasLinks && data.length === 0 && directory === undefined
      ? directoryQuery.isError
        ? "failed"
        : "loading"
      : null;
  return useMemo(() => ({ data, unnamed }), [data, unnamed]);
}
