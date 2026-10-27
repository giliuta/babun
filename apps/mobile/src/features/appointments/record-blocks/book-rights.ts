// What the `/book` page lets a person press — derived from block levels.
import type { EventBlocks, RecordBlocks, RecordLevel } from "./levels";

/** Что можно нажать на странице записи `/book` — один ответ на все двери
 *  страницы. Владельцу всё. Сотруднику — рабочая запись по блокам её
 *  календаря; своё событие при «События: Меняет» — всё, кроме клиента,
 *  объекта и календаря (сервер их у события сотрудника не принимает). */
export interface BookRights {
  editTeam: boolean;
  showLabel: boolean;
  editLabel: boolean;
  editWhen: boolean;
  showClient: boolean;
  editClient: boolean;
  showObject: boolean;
  editObject: boolean;
  showServices: boolean;
  editServices: boolean;
  editTotal: boolean;
  showMoney: boolean;
  editNote: boolean;
  editColor: boolean;
  editEventType: boolean;
  /** Блок заметки есть (у записи — «Заметка», у события — его «Заметка»). */
  showNote: boolean;
  /** Тип события показан. */
  showType: boolean;
  /** Блок файлов есть. */
  showFiles: boolean;
  /** Файлы добавляются. */
  editFiles: boolean;
  /** Блок «SMS» внизу записи. */
  showSms: boolean;
}

export function bookRights(input: {
  isMember: boolean;
  kind: "work" | "event";
  isEdit: boolean;
  record: RecordBlocks;
  /** Блоки события в его календаре; нет — как было до прав блоков события. */
  event?: EventBlocks;
  /** Сотрудник может править это событие: своё и «События: Меняет». */
  eventWritable: boolean;
}): BookRights {
  const { isMember, kind, isEdit, record, eventWritable } = input;
  if (!isMember) {
    return {
      editTeam: true,
      showLabel: true,
      editLabel: true,
      editWhen: true,
      showClient: true,
      editClient: true,
      showObject: true,
      editObject: true,
      showServices: true,
      editServices: true,
      editTotal: true,
      showMoney: true,
      editNote: true,
      editColor: true,
      editEventType: true,
      showNote: true,
      showType: true,
      showFiles: true,
      editFiles: true,
      showSms: true,
    };
  }
  if (kind === "event") {
    // Блоки события: видит — по блоку; меняет — своё событие и
    // только открытый на «Видит и меняет» блок.
    const ev = input.event ?? {
      label: "write",
      type: "write",
      client: "read",
      object: "read",
      note: "write",
      files: "write",
    };
    const edits = (level: RecordLevel) => eventWritable && level === "write";
    return {
      // Календарь новой записи выбран слотом; у сохранённой — не меняется.
      editTeam: !isEdit && eventWritable,
      showLabel: ev.label !== "hidden",
      editLabel: edits(ev.label),
      editWhen: eventWritable,
      showClient: ev.client !== "hidden",
      editClient: edits(ev.client),
      showObject: ev.object !== "hidden",
      editObject: edits(ev.object),
      showServices: false,
      editServices: false,
      editTotal: false,
      showMoney: false,
      editNote: edits(ev.note),
      // Цвет события — цвет его типа.
      editColor: edits(ev.type),
      editEventType: edits(ev.type),
      showNote: ev.note !== "hidden",
      showType: ev.type !== "hidden",
      showFiles: ev.files !== "hidden",
      editFiles: edits(ev.files),
      // SMS шлют клиенту записи — у события их блока нет.
      showSms: false,
    };
  }
  const w = (level: RecordLevel) => level === "write";
  if (!isEdit) {
    // НОВАЯ ЗАПИСЬ — ЦЕЛИКОМ ЕГО (миграция 20260924170000): «Новые записи:
    // Может» — это клиент, объект, услуги, метка, цвет и заметка своей записи;
    // запись клиента без клиента не сохраняется. Ручная цена и скидка —
    // по-прежнему «Сумма: Меняет»: каталожные цены сотрудник не перебивает.
    return {
      editTeam: true,
      showLabel: true,
      editLabel: true,
      editWhen: true,
      showClient: true,
      editClient: true,
      showObject: true,
      editObject: true,
      showServices: true,
      editServices: true,
      editTotal: w(record.amount),
      showMoney: record.amount !== "hidden",
      editNote: true,
      editColor: true,
      editEventType: false,
      showNote: true,
      showType: false,
      showFiles: record.files !== "hidden",
      editFiles: w(record.files),
      showSms: record.sms !== "hidden",
    };
  }
  return {
    editTeam: w(record.team),
    showLabel: record.label !== "hidden",
    editLabel: w(record.label),
    editWhen: w(record.when),
    showClient: record.client !== "hidden",
    editClient: w(record.client),
    showObject: record.object !== "hidden",
    editObject: w(record.object),
    showServices: record.services !== "hidden",
    editServices: w(record.services),
    editTotal: w(record.amount),
    showMoney: record.amount !== "hidden",
    editNote: w(record.note),
    editColor: w(record.color),
    editEventType: false,
    showNote: record.note !== "hidden",
    showType: false,
    showFiles: record.files !== "hidden",
    editFiles: w(record.files),
    showSms: record.sms !== "hidden",
  };
}

/** ЗАПИСЬ КЛИЕНТА БЕЗ ТАРИФА — ТОЛЬКО ДЛЯ ПРОСМОТРА (без тарифа нельзя добавлять объекты, применять
 *  услугу и менять что-либо на клиентах). Видно то же, что и с тарифом; ни одна
 *  правка не нажимается — тот же вид, что у партнёра с «Только видит»:
 *  пустой блок (объект не выбран) уходит, заполненный стоит без двери.
 *  Сервер держит то же (`tenant_free_readonly_guard`). */
export function readOnlyBookRights(rights: BookRights): BookRights {
  return {
    ...rights,
    editTeam: false,
    editLabel: false,
    editWhen: false,
    editClient: false,
    editObject: false,
    editServices: false,
    editTotal: false,
    editNote: false,
    editColor: false,
    editEventType: false,
    editFiles: false,
  };
}

/** Страница только для просмотра, хотя блоки и видны:
 *  • запись клиента без тарифа (`readOnlyBookRights` выше);
 *  • ЧУЖОЕ СОБЫТИЕ у владельца и диспетчера — сервер пускает правку события
 *    лишь его автору (`appointments_update`), и открытая дверь кончилась бы
 *    отказом. Сотруднику своё событие решает `eventWritable` в `bookRights`.
 *  Автора без `created_by` (старый кэш) не угадываем — только просмотр. */
export function bookIsReadOnly(input: {
  isMember: boolean;
  kind: "work" | "event";
  workInPlan: boolean;
  ownEvent: boolean;
}): boolean {
  if (input.kind === "work") return !input.workInPlan;
  return !input.isMember && !input.ownEvent;
}
