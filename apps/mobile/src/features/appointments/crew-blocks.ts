import type { MemberAccessMap } from "@/features/access/access-map";
import { accessGate, type AccessGate } from "@/features/access/my-access";
import { isFeatureOn, type CompanyFeatureKey } from "@babun/shared/local/company-features";

// ЧТО ИЗ ЗАПИСИ ВИДИТ И МЕНЯЕТ КОМАНДА — ОДНИМ ОТВЕТОМ (STORY-084).
//
// Карточка записи у мастера (`CrewAppointmentSheet`) до 21.09 не спрашивала
// права вовсе, а сервер уже спрашивал: при «Статус записи: Скрыт» кнопки
// статуса оставались на месте и падали отказом. Кнопка, на которую сервер
// откажет, на экране не рисуется (AGENTS, правило 10).
//
// Спрашивается КАЛЕНДАРЬ ЗАПИСИ, а не лучший по всем: права ставятся на
// календарь, и в чужом календаре человек может видеть меньше. Запись без
// календаря для не-владельца закрыта целиком — сервер её тоже маскирует.
//
// В режиме «его глазами» данные приходят владельцу БЕЗ серверной маски,
// поэтому клиента и адрес прячет сама карточка — иначе просмотр врал бы.

type Role = "owner" | "dispatcher" | "master";

export type CrewLevel = "hidden" | "read" | "write";

export interface CrewBlocks {
  /** «Статус записи». Заметку пишет тот, кто меняет статус (владелец 21.09:
   *  «если статус меняется — значит он может писать заметку»), — сервер
   *  пускает обе правки одной дверью. Читать заметку можно всегда. */
  status: CrewLevel;
  /** «Фото и файлы записи». */
  files: CrewLevel;
  /** «Клиент в записи»: два положения — видит или нет. */
  client: boolean;
  /** «Объект в записи»: адрес выезда и объект. */
  object: boolean;
  /** «Услуги в записи»: что делать — строки работ. */
  services: boolean;
  /** «Сумма записи»: цены в строках, скидка, «Итого». */
  amount: boolean;
  /** «Оплата в записи»: оплачена ли запись; сколько внесено — только вместе
   *  с «Суммой», это деньги. */
  payment: CrewLevel;
  /** Заметка записи — функция компании (STORY-088). Выключена — заметки нет
   *  ни для чтения, ни для записи. */
  note: boolean;
}

function levelOf(gate: AccessGate): CrewLevel {
  if (gate === "write") return "write";
  if (gate === "read") return "read";
  // «Ждём карту» и «человека нет» — закрытая сторона: блок появится, когда
  // карта придёт, а не мигнёт лишним.
  return "hidden";
}

export function crewBlocks(input: {
  role: Role | null | undefined;
  map: MemberAccessMap | undefined;
  teamId: string | null;
  /** Функции компании, которые выключены (STORY-088): выключенное у
   *  компании не показывается ни при каком праве — «ни у кого, даже у
   *  владельца». */
  disabledFeatures?: readonly string[];
}): CrewBlocks {
  const on = (feature: CompanyFeatureKey) => isFeatureOn(input.disabledFeatures, feature);
  const gate = (blockKey: string): CrewLevel => {
    if (input.teamId === null && input.role !== "owner") return "hidden";
    return levelOf(
      accessGate({
        role: input.role,
        map: input.map,
        blockKey,
        scope: "calendar",
        teamId: input.teamId,
      }),
    );
  };
  return {
    status: gate("record.status"),
    files: on("record_files") ? gate("record.files") : "hidden",
    client: gate("record.client") !== "hidden",
    object: on("objects") && gate("record.object") !== "hidden",
    services: gate("record.services") !== "hidden",
    amount: gate("record.amount") !== "hidden",
    payment: on("record_payment") ? gate("record.payment") : "hidden",
    note: on("record_note"),
  };
}

/** Адрес выезда. Закрыт «Объект» — адреса нет вовсе, и из карточки клиента
 *  он тоже не подставляется: это та же точка на карте другой дорогой. */
export function crewAddress(
  appointmentAddress: string,
  clientAddress: string | null | undefined,
  blocks: Pick<CrewBlocks, "client" | "object">,
): string {
  if (!blocks.object) return "";
  const fallback = blocks.client ? clientAddress ?? "" : "";
  return (appointmentAddress || fallback).trim();
}
