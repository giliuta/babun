import type { MemberAccessMap } from "@/features/access/access-map";
import { accessGate, type AccessGate } from "@/features/access/my-access";

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
}): CrewBlocks {
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
    files: gate("record.files"),
    client: gate("record.client") !== "hidden",
    object: gate("record.object") !== "hidden",
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
