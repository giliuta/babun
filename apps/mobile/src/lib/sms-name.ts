import type { Client } from "@babun/shared/local/clients";
import { stripEmoji } from "@babun/shared/local/sms-encoding";

// КАК ОБРАЩАТЬСЯ К КЛИЕНТУ В SMS — строка «Обращение» в блоке «Личное».
//
// В карточке клиент бывает записан как «Иванов Пётр (вилла Пафос)» или
// «Мария — управляющая», а в SMS нужно «Пётр» или «Мария Андреевна».
// Поле `sms_name` было в модели и в белом списке правки с самого начала,
// но ни один шаблон его не читал: [Имя] всегда собиралось из полного имени.
// Правило одно для всех мест, где шаблон подставляет [Имя]: заполнено
// «Обращение» — берём его, пусто — прежнее значение этого места.

// Эмодзи из имени вырезаются ДО подстановки: в SMS их не пропускает и
// сервер отправки, и имя из одних эмодзи иначе дало бы «Здравствуйте, !».
// Пустое имя — правильный исход: шаблон с [Имя] без имени не предлагается
// (`fillTemplate`), а сервер такой шаблон не отправляет.
const plain = (text: string | null | undefined): string =>
  stripEmoji(text ?? "").replace(/\s+/g, " ").trim();

/** Первое слово имени — чем [Имя] было до «Обращения» в массовой рассылке. */
export function firstName(client: Pick<Client, "full_name">): string {
  return plain(client.full_name).split(" ")[0] ?? "";
}

/** [Имя] для шаблона: «Обращение», а если оно пустое — `fallback`. */
export function addressedAs(
  client: Pick<Client, "sms_name"> | null | undefined,
  fallback: string,
): string {
  return plain(client?.sms_name) || plain(fallback);
}
