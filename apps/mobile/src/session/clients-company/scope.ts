import type { UserRole } from "../role-policy";

// One source of the clients tab (a company) and what it allows.

/** Своё членство: компания, роль в ней, дата вступления (`tenant_members`). */
export interface MembershipRow {
  tenantId: string;
  role: string;
  joinedAt: string;
}

/** Положение блока клиентов в чужой компании — как его отдаёт карта прав. */
export type ClientsLevel = "off" | "read" | "write";

/** Права человека в одной компании, собранные из `my_access_map()`. */
export interface CompanyAccess {
  isOwner: boolean;
  /** `undefined` — блок ещё не живой или карта без него: значит «Скрыт». */
  clients?: string;
  /** «own» — из его календарей, «all» — все клиенты компании. */
  scope?: string;
  /** «read» — телефоны видны. */
  contacts?: string;
  /** «write» — «Создание клиента: Может». */
  create?: string;
}

export type ClientsCompanyKind = "own" | "member" | "record";

/** Компания вкладки и то, что в ней можно. */
export interface ClientsScope {
  tenantId: string;
  tenantName: string | null;
  kind: ClientsCompanyKind;
  /** Роль человека в этой компании. */
  role: UserRole;
  /** «Смотрит» или «Меняет». У своей компании — всегда «Меняет». */
  level: Exclude<ClientsLevel, "off">;
  /** Видны ли телефоны, почта и мессенджеры. */
  contacts: boolean;
  /** «Все клиенты компании» вместо «из его календарей». */
  everyClient: boolean;
  /** Компания открыта в календаре: чтения и записи идут обычным клиентом. */
  isActive: boolean;
  /** Партнёр: «Создание клиента: Может» хоть в одной команде. */
  create?: boolean;
}

/** Что разрешено в этом источнике. Одно место на весь экран: строка списка,
 *  свайпы, футер, карточка и её блоки спрашивают отсюда, а не считают сами. */
export interface ClientsCapabilities {
  /** Полная база: архив, корзина, справочник тегов, импорт, массовые действия,
   *  шестерёнка. Это хозяйство СВОЕЙ компании. */
  manage: boolean;
  /** «Создать клиента». */
  create: boolean;
  /** Правка карточки. */
  edit: boolean;
  /** Телефоны, WhatsApp, почта. */
  contacts: boolean;
  /** Деньги клиента: ожидаемое, доход, долг. Чужие суммы сотруднику не
   *  приходят вовсе, поэтому в строке их нет — вместо нулей. */
  money: boolean;
  /** «Записать» — запись живёт в календаре, открытом сейчас, поэтому она
   *  возможна ровно у клиента ТОЙ компании, что сейчас открыта: и у своего,
   *  и у клиента работодателя, в чьём календаре человек и работает. */
  book: boolean;
  /** Файлы и фото: хранилище читает компанию из токена, а не из заголовка. */
  files: boolean;
  /** ЛЮДИ КАРТОЧКИ: блок есть целиком или его НЕТ. */
  links: boolean;
  /** Правка уходит на сервер сразу; очереди на потом нет. */
  onlineOnly: boolean;
  /** ВЫНЕСТИ КЛИЕНТА ИЗ ПРИЛОЖЕНИЯ — только своей компании:
   *  дали права на клиентов Команды 1 — видит, но без передачи: сохранить
   *  или выгрузить клиента себе не может. «Поделиться», копирование
   *  долгим нажатием и из поля, «Выбрать несколько» с экспортом и массовой
   *  SMS. Позвонить и написать клиенту — можно: это работа, не выгрузка. */
  export: boolean;
}

export function capabilitiesOf(scope: ClientsScope): ClientsCapabilities {
  const own = scope.kind === "own";
  const record = scope.kind === "record";
  return {
    manage: own,
    // ЗАВОДИТЬ КЛИЕНТОВ МОЖЕТ И СОТРУДНИК С «МЕНЯЕТ». Право было привязано к
    // владению компанией, и кнопка стояла серой у человека, которому сервер
    // это РАЗРЕШАЕТ: `create_client_with_tags` пускает `owner` или
    // `access_company('clients','write')`, а дорога записи в чужую компанию
    // давно написана (`useCreateClient`, ветка `member`). Фраза права при
    // этом обещала ровно это — «Заводит клиентов и правит их карточки»
    //.
    // Заводит клиентов своя база и партнёр с «Созданием клиента».
    create: !record && (scope.level === "write" || (scope.kind === "member" && !!scope.create)),
    // Правка карточки у партнёра — по блокам: база у него только
    // «Видит», а блок с «Меняет» правится. Что именно — решает `blocks`
    // строки (`card-access.ts`), имя и номера остаются владельцу.
    edit: !record && (scope.level === "write" || scope.kind === "member"),
    contacts: scope.contacts,
    money: own,
    book: !record && scope.isActive,
    // Файлы сотруднику — по «Файлам» карточки: хранилище пускает его
    // к файлам клиентов, где блок открыт (`access_block_client_ids`); что
    // именно открыто у клиента, решает `blocks` строки. Компания — активная:
    // путь в хранилище начинается с неё.
    files: (own || scope.kind === "member") && scope.isActive,
    // ЛЮДИ КАРТОЧКИ: БЛОК ЕСТЬ ЦЕЛИКОМ ИЛИ ЕГО НЕТ (STORY-086).
    //
    // `list_client_members` отдаёт людей владельцу либо сотруднику, у которого
    // набор НЕ урезан: «Какие клиенты: Все» И «Телефоны и контакты: Смотрит».
    // Урезанному она отдаёт ноль строк — и «видно, но пусто» соврало бы: связь,
    // которую нечем назвать, читается как «жилец · (никого)». Поэтому условие
    // здесь повторяет серверное слово в слово, а не смягчает его: блок либо
    // стоит целиком, либо его на странице нет.
    //
    // Клиент ЗАПИСИ сюда не проходит сам собой: его окно
    // (`list_master_clients_safe`) связей не отдаёт вовсе, а `everyClient` у
    // него `false` — набор мастера это его заявки, а не база.
    //
    // Людей сервер отдаёт по «Людям» карточки-группы,
    // а не по «Все + Телефоны»: у сотрудника блок решает `blocks` строки.
    links: own || scope.kind === "member",
    onlineOnly: !scope.isActive || scope.kind === "member",
    export: own,
  };
}

export function ownScope(
  tenantId: string,
  names: ReadonlyMap<string, string>,
  activeTenantId: string | null,
): ClientsScope {
  return {
    tenantId,
    tenantName: names.get(tenantId) ?? null,
    kind: "own",
    role: "owner",
    level: "write",
    contacts: true,
    everyClient: true,
    isActive: tenantId === activeTenantId,
  };
}
