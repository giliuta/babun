import { clientBlockLevel } from "./client-block-access";

// ЖЕСТЫ И МЕНЮ СТРОКИ СПИСКА КЛИЕНТОВ — ОДНО ПРАВИЛО НА СВОЮ БАЗУ И ГОСТЯ.
//
// Аудит 03.10: настоящий партнёр (у него своя компания, свой аккаунт) видит
// клиентов работодателя ГОСТЕВЫМИ строками, и список гасил им всё — долгое
// нажатие, «Напомнить», «Удалить», — хотя «Меню клиента» и «Удаление клиента»
// это разрешают, а «Посмотреть его глазами» их показывал: предпросмотр врал.
// Теперь строка партнёра (`blocks`) ведёт себя по своим блокам, где бы она ни
// стояла. Гостю не достаётся только «Выбрать несколько»: выгрузка, рассылка
// и массовое удаление берут лишь свою базу (`visible` списка).
//
// Лист чистый: экран отдаёт права КОМПАНИИ СТРОКИ — своей у своей строки,
// работодателя у гостевой (`capabilitiesOf`), — а записи гостя уходят в его
// компанию (`source` у мутаций в `queries.ts`).

/** Права компании строки — те же поля, что у `capabilitiesOf`. */
export interface ClientRowRights {
  /** Своя база: «меняет карточку» (у списка — ещё и тариф). */
  edit: boolean;
  /** Своя база: хозяйство, в том числе «Удалить». */
  manage: boolean;
  /** «Можно вынести»: «Поделиться» и «Выбрать несколько». */
  export: boolean;
  /** «Записать»: календарь этой компании открыт сейчас. */
  book: boolean;
}

export interface ClientRowActionsInput {
  client: { blocks?: Readonly<Record<string, string>> | null };
  /** Клиент компании-работодателя (`guestOf` списка). */
  guest: boolean;
  /** Режим «Выбрать несколько». */
  selecting: boolean;
  rights: ClientRowRights;
  /** «Новые записи» в команде записи (`calendarActionsFor`). Нужно только
   *  листу действий: строке «Записать» не показывают, хватает `false`. */
  teamCreate?: boolean;
}

export interface ClientRowActions {
  /** Долгое нажатие отмечает строку (режим выбора). */
  select: boolean;
  /** Долгое нажатие открывает меню клиента. */
  menu: boolean;
  /** «Напомнить» — свайп вправо и пункт меню. */
  remind: boolean;
  /** «В чёрный список» — пункт меню. */
  blacklist: boolean;
  /** «Удалить» — свайп влево и пункт меню. */
  remove: boolean;
  share: boolean;
  selectMany: boolean;
  book: boolean;
}

const NOTHING: ClientRowActions = {
  select: false,
  menu: false,
  remind: false,
  blacklist: false,
  remove: false,
  share: false,
  selectMany: false,
  book: false,
};

export function clientRowActions(input: ClientRowActionsInput): ClientRowActions {
  const { client, guest, selecting, rights, teamCreate = false } = input;
  const partner = !!client.blocks;
  // Гость без `blocks` — сервер до наката прав по блокам: что ему можно,
  // неизвестно, а права своей базы к чужому клиенту не относятся.
  if (guest && !partner) return NOTHING;
  // «МЕНЮ КЛИЕНТА» (владелец 02.10: «зажимаю на клиенте — открывается
  // менюшка… может или не может»; 03.10 — «всё меню, кроме „Удалить"»):
  // у строки партнёра — его право на ЭТОГО клиента; своя база — как была.
  const menuWrite = partner && clientBlockLevel(client, "clients.menu") === "write";
  // «Удаление клиента» (03.10) — своим правом, как «Отмена и удаление».
  const deleteWrite = partner && clientBlockLevel(client, "clients.delete") === "write";
  // «Напомнить» и «В чёрный список»: своя база — по праву карточки, партнёр
  // — по «Меню клиента».
  const edit = partner ? menuWrite : rights.edit;
  // «Удалить»: своя база — владелец, партнёр — «Удаление клиента».
  const remove = partner ? deleteWrite : rights.manage;
  // «Поделиться»: своя база — «можно вынести», партнёр — «Меню клиента».
  const exportable = partner ? menuWrite : rights.export;
  // Меню — те же права, что у его пунктов; ни одного — нет и пустой шторки
  // (проверка глазами 30.09).
  const menu = partner
    ? menuWrite || deleteWrite
    : rights.book || rights.export || rights.manage || edit;
  return {
    // Гостя не отмечают: в выбор попадает только своя база.
    select: selecting && !guest,
    menu: !selecting && menu,
    // В режиме выбора свайпов нет ни у одной строки: у своей их гасит сам
    // ряд, у гостевой, которая не отмечается, — это правило.
    remind: !selecting && edit,
    blacklist: edit,
    remove: !selecting && remove,
    share: exportable,
    // «Выбрать несколько» ведёт к выгрузке и массовой SMS — клиентов
    // работодателя в них не бывает (владелец 01.10), и партнёру он не
    // даётся никогда, в том числе «его глазами» (владелец 02.10).
    selectMany: !guest && !partner && exportable,
    // «Записать» — только с «Новыми записями» в команде записи (03.10: «если
    // нет разрешения на запись — этого и не будет»); партнёру ещё и с «Меню
    // клиента». Календарь — компании строки, и он должен быть открыт.
    book: rights.book && (!partner || menuWrite) && teamCreate,
  };
}
