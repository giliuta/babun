import type { Client } from "@babun/shared/local/clients";
import type { ClientsCapabilities } from "./clients-company";
import { clientBlockLevel, type ClientCardBlock } from "./client-block-access";

// ЧТО ВИДНО И ЧТО ПРАВИТСЯ НА КАРТОЧКЕ КЛИЕНТА — ОДНИМ ОТВЕТОМ (30.09).
//
// Три источника складываются, и складываться им негде, кроме этого места:
//   • выключатель КОМАНДЫ клиента («Карточка клиента» в настройках клиентов,
//     `team_design.disabled_blocks`) — выключенного блока нет ни у кого;
//   • права СОТРУДНИКА по блокам (015: строка сервера несёт `blocks`, поля
//     закрытых блоков приходят пустыми) — «Скрыт» / «Видит» / «Меняет»;
//   • прежние права компании (`caps`) — для строк без `blocks`: у владельца
//     и до наката миграции всё ведёт себя как раньше.
// «Меняет» у блока работает само по себе (владелец 02.10: «если поставлено
// „Меняет" — может редактировать полноценно объекты и всё, что нужно»), а
// база — имя, номера, команда — у сотрудника только «Видит»: её правит
// владелец. Так решает и сервер (`access_client_blocks`,
// `update_client_with_tags`).
//
// Черновик нового клиента в СВОЕЙ компании — блоки как у владельца. У
// сотрудника в компании работодателя сервер (`create_client_with_tags`) МОЛЧА
// пишет пустыми блоки без «Меняет» в команде клиента: теги, связи, заметка
// пропали бы без ошибки. Поэтому черновик сотрудника получает положения из
// его карты прав (`draftBlocks`) и показывает только блоки с «Меняет».

export type CardBlockKey =
  | "note"
  | "people"
  | "objects"
  | "labels"
  | "tags"
  | "personal"
  | "files"
  | "requisites"
  | "history"
  | "money"
  | "sms";

export interface BlockAccess {
  show: boolean;
  edit: boolean;
}

export type CardAccess = Record<CardBlockKey | "card", BlockAccess>;

/** Выключатели команды клиента («Карточка клиента»). */
export type TeamBlocksOn = Record<
  "note" | "people" | "objects" | "labels" | "tags" | "personal" | "files" | "requisites",
  boolean
>;

type Caps = Pick<ClientsCapabilities, "edit" | "money" | "files" | "links">;

export function cardAccess({
  client,
  caps,
  teamOn,
  draft,
  draftBlocks,
}: {
  client: Pick<Client, "blocks"> | null | undefined;
  caps: Caps;
  teamOn: TeamBlocksOn;
  draft: boolean;
  /** Положения черновика сотрудника по его карте прав (`mirrorClientBlocks`). */
  draftBlocks?: Readonly<Record<string, string>> | null;
}): CardAccess {
  const draftByRights = draft && !!draftBlocks;
  const byRights = draftByRights || (!draft && !!client?.blocks);
  const rights = draftByRights ? { blocks: draftBlocks ?? undefined } : client;
  // Имя, номер и мессенджеры — блок «Клиент» (02.10: «Скрыт / Видит /
  // Меняет»); у строк без `blocks` (владелец) — как раньше.
  const cardEdit =
    draft ||
    (caps.edit &&
      (byRights
        ? clientBlockLevel(rights, "clients.client") === "write"
        : clientBlockLevel(client, "clients") === "write"));

  // `legacy*` — как блок жил до прав по блокам: у владельца и у строк без
  // `blocks` поведение не меняется ни на пиксель.
  const block = (
    on: boolean,
    key: ClientCardBlock,
    legacyShow = true,
    legacyEdit = cardEdit,
  ): BlockAccess => {
    if (!on) return { show: false, edit: false };
    if (!byRights) return { show: legacyShow, edit: legacyShow && legacyEdit };
    const level = clientBlockLevel(rights, key);
    // В черновике «Видит» показывать нечего — пустое поле без права вписать.
    if (draftByRights) return { show: level === "write", edit: level === "write" };
    return { show: level !== "hidden", edit: level === "write" };
  };

  return {
    card: { show: true, edit: cardEdit },
    note: block(teamOn.note, "clients.note"),
    people: block(teamOn.people, "clients.people", caps.links, caps.edit && caps.links),
    objects: block(teamOn.objects, "clients.objects"),
    // Метку и тег черновик тоже ставит только с правом менять карточки.
    labels: block(teamOn.labels, "clients.labels", true, caps.edit),
    // «Тег» — свой выключатель команды (03.10); право сотрудника у метки и
    // тега одно — «Метка и тег».
    tags: block(teamOn.tags, "clients.labels", true, caps.edit),
    personal: block(teamOn.personal, "clients.personal"),
    // Файлы кладёт хранилище, которое видит компанию из токена (`caps.files`).
    files: {
      ...block(teamOn.files, "clients.files", caps.money, caps.edit && caps.files),
      ...(byRights && teamOn.files
        ? { edit: clientBlockLevel(rights, "clients.files") === "write" && caps.files }
        : {}),
    },
    requisites: block(teamOn.requisites, "clients.requisites", caps.money),
    history: block(true, "clients.history"),
    money: block(true, "clients.money", caps.money, false),
    // SMS клиента — свой блок (02.10): «Видит» — история, «Меняет» —
    // отправка с карточки, «Присылать SMS» и имя для SMS.
    sms: block(true, "clients.sms"),
  };
}

/** СВОДКА КЛИЕНТА ПО ЕГО ПРАВАМ (аудит 015, 30.09). Сводку считает экран
 *  из записей, которые сотрудник видит по правам КАЛЕНДАРЯ, — и без маски
 *  долг, выручка и «был …» пролезли бы в строку списка, сортировку «по
 *  долгу», фильтр «Должники» и строку истории в записи мимо прав КЛИЕНТА.
 *  Без «Долг и деньги» — денег нет; без «Истории записей» — визитов и дат нет.
 *  Строка без `blocks` (владелец) — как есть. */
export function statsByBlocks<S extends {
  visits: number;
  totalSpent: number;
  lastVisitDate: string;
  lastVisitDays: number | null;
  nextApt: unknown;
  nextAptDays: number | null;
  medianGapDays: number | null;
  serviceDue: number;
  unclosedVisits: number;
  debt: number;
  expectedRevenue: number;
}>(client: Pick<Client, "blocks">, stats: S): S {
  if (!client.blocks) return stats;
  const noMoney = clientBlockLevel(client, "clients.money") === "hidden";
  const noHistory = clientBlockLevel(client, "clients.history") === "hidden";
  if (!noMoney && !noHistory) return stats;
  return {
    ...stats,
    ...(noMoney ? { totalSpent: 0, debt: 0, expectedRevenue: 0 } : {}),
    ...(noHistory
      ? {
          visits: 0,
          lastVisitDate: "",
          lastVisitDays: null,
          nextApt: null,
          nextAptDays: null,
          medianGapDays: null,
          serviceDue: 0,
          unclosedVisits: 0,
        }
      : {}),
  };
}
