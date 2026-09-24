import type { Client } from "@babun/shared/local/clients";

// КАК ОБРАЩАТЬСЯ К КЛИЕНТУ В SMS — строка «Обращение» в блоке «Личное».
//
// В карточке клиент бывает записан как «Иванов Пётр (вилла Пафос)» или
// «Мария — управляющая», а в SMS нужно «Пётр» или «Мария Андреевна».
// Поле `sms_name` было в модели и в белом списке правки с самого начала,
// но ни один шаблон его не читал: [Имя] всегда собиралось из полного имени.
// Правило одно для всех мест, где шаблон подставляет [Имя]: заполнено
// «Обращение» — берём его, пусто — прежнее значение этого места.

/** Первое слово имени — чем [Имя] было до «Обращения» в массовой рассылке. */
export function firstName(client: Pick<Client, "full_name">): string {
  return (client.full_name || "").trim().split(/\s+/)[0] ?? "";
}

/** [Имя] для шаблона: «Обращение», а если оно пустое — `fallback`. */
export function addressedAs(
  client: Pick<Client, "sms_name"> | null | undefined,
  fallback: string,
): string {
  return (client?.sms_name ?? "").trim() || fallback.trim();
}
