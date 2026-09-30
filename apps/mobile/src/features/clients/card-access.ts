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
// «Меняет» у блока работает, только если меняется сама карточка
// (`clients: write`), — так решает и сервер.
//
// Черновик нового клиента — СВОЙ клиент, `blocks` у него нет: блоки как у
// владельца, их правят все, кто создаёт.

export type CardBlockKey =
  | "note"
  | "people"
  | "objects"
  | "labels"
  | "personal"
  | "files"
  | "requisites"
  | "history"
  | "money";

export interface BlockAccess {
  show: boolean;
  edit: boolean;
}

export type CardAccess = Record<CardBlockKey | "card", BlockAccess>;

/** Выключатели команды клиента («Карточка клиента»). */
export type TeamBlocksOn = Record<
  "note" | "people" | "objects" | "labels" | "personal" | "files" | "requisites",
  boolean
>;

type Caps = Pick<ClientsCapabilities, "edit" | "money" | "files" | "links">;

export function cardAccess({
  client,
  caps,
  teamOn,
  draft,
}: {
  client: Pick<Client, "blocks"> | null | undefined;
  caps: Caps;
  teamOn: TeamBlocksOn;
  draft: boolean;
}): CardAccess {
  const byRights = !draft && !!client?.blocks;
  const cardEdit = draft || (caps.edit && clientBlockLevel(client, "clients") === "write");

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
    const level = clientBlockLevel(client, key);
    return { show: level !== "hidden", edit: level === "write" && cardEdit };
  };

  return {
    card: { show: true, edit: cardEdit },
    note: block(teamOn.note, "clients.note"),
    people: block(teamOn.people, "clients.people", caps.links, caps.edit && caps.links),
    objects: block(teamOn.objects, "clients.objects"),
    // Метку и тег черновик тоже ставит только с правом менять карточки.
    labels: block(teamOn.labels, "clients.labels", true, caps.edit),
    personal: block(teamOn.personal, "clients.personal"),
    // Файлы кладёт хранилище, которое видит компанию из токена (`caps.files`).
    files: {
      ...block(teamOn.files, "clients.files", caps.money, caps.edit && caps.files),
      ...(byRights && teamOn.files
        ? { edit: clientBlockLevel(client, "clients.files") === "write" && cardEdit && caps.files }
        : {}),
    },
    requisites: block(teamOn.requisites, "clients.requisites", caps.money),
    history: block(true, "clients.history"),
    money: block(true, "clients.money", caps.money, false),
  };
}
