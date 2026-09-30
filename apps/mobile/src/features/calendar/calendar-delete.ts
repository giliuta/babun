// УДАЛЕНИЕ КАЛЕНДАРЯ — В ДВА ШАГА, И КАЖДЫЙ ГОВОРИТ, ЧТО СДЕЛАЕТ.
//
// Владелец 2026-09-21, по порядку:
//
//   1. «в календаре почему-то появилась команда два… почему оно не ушло» —
//      удалённая им «Команда 2» неделю стояла в ленте календаря.
//   2. «удаляется сразу и записи, и финансы; клиенты остаются» — появилась
//      серверная дверь настоящего удаления (`delete_calendar`).
//   3. «удаляешь — оно кидается в архив и в архиве хранится, потом можно
//      удалить с архива… архив засунь в Кабинет».
//
// Итог — два шага. «Удалить» в настройках календаря уводит его В АРХИВ:
// календарь пропадает из ленты, пикеров и финансов, записи остаются в
// карточках клиентов, всё обратимо. «Удалить навсегда» живёт только в
// Кабинете → «Архив» и стирает календарь с записями, счетами и прайсом;
// клиенты остаются, выданные инвойсы аннулируются (номер документа —
// юридическая последовательность, база сама запрещает её рвать).
//
// Первый вопрос обратим и потому короткий. Второй необратим — и показывает
// цену цифрами: 14 записей и 2 счёта читаются иначе, чем «данные».

import { formatCountRu, pluralRu } from "@babun/shared/common/utils/plural-ru";

/** Вопрос шага «в архив». Цифр нет намеренно: шаг обратим, а цифры в нём
 *  пугали бы тем, чего не случится. */
export const ARCHIVE_CALENDAR_MESSAGE =
  "Он уйдёт в архив: пропадёт из ленты и из финансов. Записи останутся в карточках клиентов. Стереть навсегда можно в Кабинете → Архив.";

/** Минимум полей, нужных счёту: формы целиком тут ни при чём. */
export interface CalendarWorkRow {
  team_id?: string | null;
}
export interface CalendarAccountRow {
  brigade_id?: string | null;
}
export interface CalendarDocumentRow {
  brigade_id?: string | null;
  status?: string | null;
}

export interface CalendarDeleteImpact {
  /** ВСЕ записи календаря — прошлые тоже: стираются все. */
  appointments: number;
  /** Счета календаря; операции уходят вместе с ними. */
  accounts: number;
  /** Живые инвойсы календаря — их штампуют «аннулирован». */
  documents: number;
}

/** Что уйдёт вместе с календарём. Считается по тем же правилам, что и на
 *  сервере: записи и счета — по ссылке на календарь, документы — живые, то
 *  есть ещё не аннулированные. */
export function calendarDeleteImpact(input: {
  teamId: string;
  appointments: readonly CalendarWorkRow[];
  accounts: readonly CalendarAccountRow[];
  documents: readonly CalendarDocumentRow[];
}): CalendarDeleteImpact {
  const { teamId } = input;
  return {
    appointments: input.appointments.filter((row) => row.team_id === teamId).length,
    accounts: input.accounts.filter((row) => row.brigade_id === teamId).length,
    documents: input.documents.filter(
      (row) => row.brigade_id === teamId && row.status !== "void",
    ).length,
  };
}

/** Вопрос шага «удалить навсегда» — с ценой цифрами. */
export function eraseCalendarMessage(impact: CalendarDeleteImpact): string {
  const parts: string[] = [];
  if (impact.appointments > 0) {
    parts.push(formatCountRu(impact.appointments, ["запись", "записи", "записей"]));
  }
  if (impact.accounts > 0) {
    parts.push(
      `${formatCountRu(impact.accounts, ["счёт", "счёта", "счетов"])} со всеми операциями`,
    );
  }
  // ПЕРЕЧЕНЬ ЧЕРЕЗ ДВОЕТОЧИЕ, А НЕ ФРАЗОЙ. «Удалится 1 запись» и «удалятся
  // 2 записи» требуют разного глагола, а в перечне глагол один на всех — и
  // согласовывать его не с чем.
  const lead =
    parts.length > 0
      ? `Вместе с ним удалятся: ${parts.join(", ")}.`
      : "Записей и счетов у него нет — удалятся только его настройки.";
  const documents =
    impact.documents > 0
      ? ` ${formatCountRu(impact.documents, ["инвойс", "инвойса", "инвойсов"])} ${pluralRu(
          impact.documents,
          ["будет аннулирован", "будут аннулированы", "будут аннулированы"],
        )}.`
      : "";
  return `${lead}${documents} Клиенты останутся в базе. Вернуть будет нельзя.`;
}
