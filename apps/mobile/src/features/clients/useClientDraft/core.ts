import type { Client } from "@babun/shared/local/clients";
import type { LinkTarget } from "@/features/clients/use-link-writer";

// ─── ЧИСТОЕ ЯДРО: НАЧАЛО ───────────────────────────────────────────────
//
// Гейт черновика — правило продукта, а не деталь вёрстки, поэтому он вынесен
// чистой функцией между метками: сторож `link-writer.test.ts` вырезает эту
// секцию и проверяет её вызовом (сам хук тянет `expo-router`, в bun его не
// поднять). В ядро не ввозится ни одного значения — только типы.

/** Что знает гейт о черновике в эту секунду. */
/** Что открыть на карточке сразу после создания из черновика: «Кто это»,
 *  лист «Добавить файл» или форму записи (при создании — те же блоки, что у
 *  созданного). */
export type DraftOpen = "person" | "files" | "book";

export interface DraftGate {
  active: boolean;
  nameFilled: boolean;
  /** Разобранный номер; `null` — номера нет или он не разобран. */
  e164: string | null;
  /** В поле номера набрано что-то сверх кода страны. */
  phoneTyped: boolean;
  /** Черновик несёт связь (жилец, человек карточки). */
  linked: boolean;
  duplicate: boolean;
  saving: boolean;
}

/** МОЖНО ЛИ СОЗДАТЬ КЛИЕНТА.
 *
 *  ТЕЛЕФОН НЕОБЯЗАТЕЛЕН: достаточно написать имя и сохранить клиента.
 *  УНИКАЛЬНОСТЬ остаётся: набранный номер проверяется на дубль.
 *
 *  Начатый, но не разобранный номер — не «номера нет», а ошибка набора: его
 *  дописывают или стирают, иначе в базу уехал бы обрывок цифр без ключа.
 *
 *  ДУБЛИ У БЕЗНОМЕРНЫХ НЕ ИЩУТСЯ — это принятая цена: дедуп держится на
 *  `phone_e164`, а по имени его не построить (тёзок сколько угодно).
 *  Двух Иванов-жильцов без номеров база различит только
 *  по связи. */
export function draftCanSave(gate: DraftGate): boolean {
  if (!gate.active || !gate.nameFilled || gate.duplicate || gate.saving) return false;
  if (gate.e164 !== null) return true;
  return !gate.phoneTyped;
}

/** Набрано ли в поле номера что-то сверх кода страны: поле рождается с ним
 *  (`+357 `), и сам код номером не считается. */
export function draftPhoneTyped(text: string, dial: string): boolean {
  const typed = text.trim();
  return typed !== "" && typed !== dial.trim();
}

/** ЕСТЬ ЛИ В ЧЕРНОВИКЕ НАБРАННОЕ — то, что «Назад» не вправе выбросить молча.
 *  Код страны в поле номера набранным не считается: поле рождается пустым, а
 *  сравнение «номер ≠ код» на пустом поле истинно всегда — пустое «Создать
 *  клиента» спрашивало бы «Удалить черновик?», и свайп назад был бы
 *  выключен. */
export function draftHasInput(draft: Client, dial: string): boolean {
  return Boolean(
    draft.full_name.trim() ||
      draftPhoneTyped(draft.phone, dial) ||
      draft.email.trim() ||
      draft.city.trim() ||
      draft.birthday ||
      draft.whatsapp_phone.trim() ||
      draft.telegram_username.trim() ||
      draft.instagram_username.trim() ||
      // Строка «Телефон 2», где номер стёрт до кода, набранным не считается —
      // как и само поле номера выше.
      draft.phones.some((p) => draftPhoneTyped(p.number ?? "", dial)) ||
      draft.legal_name?.trim() ||
      draft.vat_number?.trim() ||
      draft.reg_number?.trim() ||
      draft.billing_address?.trim() ||
      draft.locations.length ||
      draft.notes.length ||
      draft.tag_ids.length ||
      // Связь, приехавшая с дверью, — тоже набранное: без этой строки
      // черновик жильца уходил по «Назад» молча, и человек пропадал вместе
      // с тем, что его заводили именно в эту виллу.
      draft.memberships?.length ||
      draft.acquisition_source !== "unknown" ||
      draft.blacklisted
  );
}

/** Параметры маршрута черновика, открытого дверью связи (сценарий г-б). */
export type DraftLinkParams = {
  name?: string;
  phone?: string;
  linkGroup?: string;
  linkRole?: string;
  linkPlace?: string;
};

/** СВЯЗЬ ЕДЕТ В ЧЕРНОВИК АДРЕСОМ, И СОБИРАЕТ ЕГО ТОТ ЖЕ ФАЙЛ, ЧТО РАЗБИРАЕТ.
 *
 *  Дверь «Создать клиента» в шторке людей открывает страницу черновика
 *  маршрутом: память между экранами не переживает ни перезапуск, ни второй
 *  черновик. Пустые значения в адрес не кладутся — `?phone=` читался бы
 *  набранным номером. */
export function draftLinkParams(
  groupId: string,
  link: { role: string; locationId?: string | null },
  prefill: { name?: string; phone?: string },
): DraftLinkParams {
  const params: DraftLinkParams = { linkGroup: groupId };
  const role = link.role.trim();
  if (role) params.linkRole = role;
  if (link.locationId) params.linkPlace = link.locationId;
  const name = prefill.name?.trim();
  if (name) params.name = name;
  const phone = prefill.phone?.trim();
  if (phone) params.phone = phone;
  return params;
}

/** Обратный ход: адрес → связь черновика. Нет карточки-группы — связи нет
 *  (роль и место без неё ни к чему не привязаны). */
export function draftLinkFromParams(params: DraftLinkParams): LinkTarget | null {
  const groupId = params.linkGroup?.trim();
  if (!groupId) return null;
  return {
    groupId,
    role: params.linkRole?.trim() ?? "",
    locationId: params.linkPlace?.trim() || null,
  };
}

// ─── ЧИСТОЕ ЯДРО: КОНЕЦ ────────────────────────────────────────────────
