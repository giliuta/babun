import { createBlankClient, type Location } from "@babun/shared/local/clients";

import type { ServicesBlockLine } from "@/features/appointments/ServicesBlock";
import {
  calendarActions,
  recordBlocks,
  type CalendarActions,
  type RecordBlocks,
} from "@/features/appointments/record-blocks";
import type { RecordRow } from "@/features/finances/record-rows";

import type { AccessBlock, AccessLevel, MemberAccessMap } from "../access-map";

// ПРИМЕР ДЛЯ ВИДА БЛОКА В ШТОРКЕ ПРАВА (владелец 29.09: «сам этот блок
// вставить визуально в этой шторке»). В шторке стоит НАСТОЯЩИЙ блок продукта
// с выдуманными данными, а что в нём видно и что нажимается, считает ТО ЖЕ
// правило, что страница записи у сотрудника (`recordBlocks`,
// `calendarActions`). Поэтому вид в шторке не может разойтись с тем, что он
// увидит: одно правило на оба экрана.

const PREVIEW_TEAM = "preview-team";

export const SAMPLE_CLIENT = createBlankClient({
  id: "preview-client",
  full_name: "Анна Петрова",
  phone: "+35799123456",
});

export const SAMPLE_LOCATION: Location = {
  id: "preview-location",
  label: "Вилла",
  address: "Лимассол, Agiou Georgiou 12",
  isPrimary: true,
};

export const SAMPLE_SERVICES: readonly ServicesBlockLine[] = [
  { id: "s1", name: "Чистка кондиционера", subtitle: "1 ч", qty: 2, pricePerUnit: 60, total: 120 },
  { id: "s2", name: "Заправка фреоном", subtitle: "30 мин", qty: 1, pricePerUnit: 80, total: 80 },
];

export const SAMPLE_TOTAL = 200;

const row = (over: Partial<RecordRow> & Pick<RecordRow, "key" | "title" | "amount">): RecordRow => ({
  appointmentId: null,
  services: [],
  date: "2026-09-29",
  time: null,
  count: 1,
  ...over,
});

export const SAMPLE_INCOME = row({
  key: "income",
  title: "Анна Петрова",
  services: ["Чистка кондиционера"],
  amount: 120,
  time: "10:00",
});

export const SAMPLE_EXPENSE = row({ key: "expense", title: "Фреон R32", subtitle: "Материалы", amount: -40 });

export const SAMPLE_DEBT = row({ key: "debt", title: "Иван Смирнов", subtitle: "Заправка фреоном", amount: 80 });

// Ручные операции команды: своя («добавил он») открыта уже на «Добавляет»,
// чужая («добавили вы») — только на «Правит всё». Оплата записи
// (`SAMPLE_INCOME`) здесь не правится вовсе: её ведёт блок «Оплата».
export const SAMPLE_INCOME_OWN = row({ key: "income-own", title: "Продажа фильтра", subtitle: "Добавил он", amount: 40 });
export const SAMPLE_INCOME_OTHER = row({ key: "income-other", title: "Аренда инструмента", subtitle: "Добавили вы", amount: 60 });
export const SAMPLE_EXPENSE_OWN = row({ key: "expense-own", title: "Бензин", subtitle: "Добавил он", amount: -25 });
export const SAMPLE_EXPENSE_OTHER = row({ key: "expense-other", title: "Фреон R32", subtitle: "Добавили вы", amount: -40 });

/** Карта прав сотрудника с положениями ОДНОЙ команды — такой её видит
 *  страница записи. */
function previewMap(levels: Readonly<Record<string, AccessLevel>>): MemberAccessMap {
  return {
    tenantId: "preview",
    isOwner: false,
    version: 0,
    company: {},
    calendars: { [PREVIEW_TEAM]: { ...levels } },
    attachedCalendars: [PREVIEW_TEAM],
  };
}

/** Блоки записи глазами сотрудника с этими положениями. */
export function previewRecord(
  blocks: readonly AccessBlock[],
  levels: Readonly<Record<string, AccessLevel>>,
): RecordBlocks {
  return recordBlocks({ role: "master", map: previewMap(levels), registry: blocks, teamId: PREVIEW_TEAM });
}

export interface SampleTile {
  title: string;
  sub: string;
}

/** Подпись записи на сетке дня — как её подпишет календарь сотрудника. Клиент
 *  закрыт — сервер не отдаёт его, и `DayView` пишет «Запись»; услуги закрыты —
 *  под именем остаётся одно время. */
export function sampleTile(record: Pick<RecordBlocks, "client" | "services">): SampleTile {
  const time = "10:00–11:00";
  return {
    title: record.client === "hidden" ? "Запись" : SAMPLE_CLIENT.full_name,
    sub: record.services === "hidden" ? time : `${time} · ${SAMPLE_SERVICES[0]?.name ?? ""}`,
  };
}

/** Действия календаря глазами сотрудника с этими положениями. */
export function previewActions(
  blocks: readonly AccessBlock[],
  levels: Readonly<Record<string, AccessLevel>>,
): CalendarActions {
  return calendarActions({ role: "master", map: previewMap(levels), registry: blocks, teamId: PREVIEW_TEAM });
}
