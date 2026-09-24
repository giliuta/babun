import type { Client, Location } from "@babun/shared/local/clients";

// «ПОДЕЛИТЬСЯ» КЛИЕНТОМ — ТЕКСТ ДЛЯ БРИГАДЫ.
//
// Раньше уходили имя, телефон и ОДИН адрес (основной). Бригаде этого мало:
// у клиента бывает дом и офис, у управляющей — десять вилл, и без ссылки на
// карту и заметки у порога («зелёная дверь, домофон 25») мастер звонит
// диспетчеру с дороги. Теперь уходят ВСЕ объекты — каждый своим абзацем:
// «Тип: адрес», ссылка на карту, заметка.
//
// РЕКВИЗИТЫ — ТОЛЬКО ПО ПРАВУ. Это получатель на инвойсе, документы и деньги
// (STORY-085): страница показывает их лишь тому, кому видны деньги
// (`caps.money`), и в текст они попадают по тому же праву — иначе «Поделиться»
// вынесло бы наружу то, чего на экране у человека нет.
//
// Чистые функции без React и react-native: их гоняет `client-share.test.ts`.

type ShareClient = Pick<
  Client,
  | "full_name"
  | "phone"
  | "locations"
  | "legal_name"
  | "vat_number"
  | "reg_number"
  | "billing_address"
>;

export interface ShareTextOptions {
  /** Добавить блок реквизитов (право страницы — `caps.money`). */
  requisites: boolean;
}

const clean = (v: string | null | undefined) => (v ?? "").trim();

/** Реквизиты клиента построчно: юр. имя, VAT, рег. номер, адрес. Пустые поля
 *  не печатаются. Этим же текстом их копирует долгое нажатие по строке
 *  реквизитов — одно слово на обе дороги. */
export function requisitesLines(client: Pick<
  Client,
  "legal_name" | "vat_number" | "reg_number" | "billing_address"
>): string[] {
  const vat = clean(client.vat_number);
  const reg = clean(client.reg_number);
  return [
    clean(client.legal_name),
    vat ? `VAT ${vat}` : "",
    reg ? `Рег. ${reg}` : "",
    // Юр. адрес бывает набран в несколько строк — в тексте он остаётся одной.
    clean(client.billing_address).replace(/\s*[\n\r]+\s*/g, ", "),
  ].filter(Boolean);
}

/** Абзац одного объекта: «Тип: адрес», ссылка на карту, заметка. */
function objectLines(loc: Location): string[] {
  const label = clean(loc.label) || "Объект";
  const address = clean(loc.address);
  const map = clean(loc.mapUrl);
  const note = clean(loc.note).replace(/\s*[\n\r]+\s*/g, " ");
  return [address ? `${label}: ${address}` : label, map, note].filter(Boolean);
}

/** Текст «Поделиться»: имя и телефон, затем каждый объект абзацем (основной
 *  первым — как в блоке «Объекты»), затем реквизиты по праву. */
export function shareText(client: ShareClient, opts: ShareTextOptions): string {
  const head = [clean(client.full_name) || "Клиент", clean(client.phone)].filter(Boolean);
  const objects = [...(client.locations ?? [])]
    .sort((a, b) => Number(!!b.isPrimary) - Number(!!a.isPrimary))
    .map(objectLines);
  const requisites = opts.requisites ? requisitesLines(client) : [];
  const paragraphs = [
    head,
    ...objects,
    requisites.length > 0 ? ["Реквизиты:", ...requisites] : [],
  ].filter((lines) => lines.length > 0);
  return paragraphs.map((lines) => lines.join("\n")).join("\n\n");
}
