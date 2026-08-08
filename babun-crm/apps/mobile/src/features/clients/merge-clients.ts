import type { Client, Location, PhoneEntry } from "@babun/shared/local/clients";

// СЛИЯНИЕ ДУБЛЕЙ.
//
// Один и тот же человек заводится дважды буднично: позвонил с другого
// номера, приехал импорт, два диспетчера писали параллельно. Дальше он живёт
// в базе как двое: половина визитов тут, половина там, долг ни у кого не
// сходится, «Пора дозаписать» показывает пустышку.
//
// Слияние НЕ ВЫБИРАЕТ, кто «правильный»: оно ДОПОЛНЯЕТ основную карточку
// тем, чего в ней нет, и ничего не затирает. Правила:
//   • скалярное поле берётся из дубля, только если в основной оно пустое;
//   • номер дубля становится дополнительным (если такого ещё нет);
//   • объекты, заметки и теги складываются без повторов;
//   • чёрный список «липкий»: если хоть один помечен — слитый помечен тоже;
//   • деньги (balance) складываются: это долги/авансы одного человека.
//
// Записи переносятся отдельно (client_id), а дубль уходит в архив, а не
// удаляется: если слили не тех, карточка на месте.

/** Ключ номера для сравнения — только цифры, хвост в 8 знаков. Так «99 12
 *  34 56», «+357 99123456» и «0035799123456» становятся одним номером. */
export function phoneKey(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length > 8 ? digits.slice(-8) : digits;
}

const filled = (v: string | null | undefined): boolean =>
  typeof v === "string" && v.trim().length > 0;

/** Патч ОСНОВНОЙ карточки: что забрать у дубля. */
export function mergeClientPatch(primary: Client, dup: Client): Partial<Client> {
  const patch: Partial<Client> = {};

  // ── скаляры: заполняем только пустое ──
  const scalars: (keyof Client)[] = [
    "full_name",
    "email",
    "whatsapp_phone",
    "telegram_username",
    "instagram_username",
    "birthday",
    "city",
    "comment",
    "sms_name",
  ];
  for (const key of scalars) {
    const mine = primary[key] as string | undefined;
    const theirs = dup[key] as string | undefined;
    if (!filled(mine) && filled(theirs)) {
      (patch as Record<string, unknown>)[key] = theirs;
    }
  }
  if (
    (!primary.acquisition_source || primary.acquisition_source === "unknown") &&
    dup.acquisition_source &&
    dup.acquisition_source !== "unknown"
  ) {
    patch.acquisition_source = dup.acquisition_source;
  }
  if (
    !primary.referred_by_client_id &&
    dup.referred_by_client_id &&
    // Дубль мог «привести» сам себя или основную карточку — после слияния
    // это стало бы ссылкой человека на самого себя, которую пикер выбрать
    // не даёт (excludeId), а карточка честно напечатала бы «Кто привёл: он же».
    dup.referred_by_client_id !== primary.id &&
    dup.referred_by_client_id !== dup.id
  ) {
    patch.referred_by_client_id = dup.referred_by_client_id;
  }

  // ── номера: основной номер дубля переезжает в дополнительные ──
  const known = new Set<string>();
  known.add(phoneKey(primary.phone));
  for (const p of primary.phones ?? []) known.add(phoneKey(p.number));
  const addPhones: PhoneEntry[] = [];
  const candidates: PhoneEntry[] = [
    ...(filled(dup.phone)
      ? [{ id: `dup-${dup.id}`, number: dup.phone, label: "Мобильный" }]
      : []),
    ...(dup.phones ?? []),
  ];
  for (const p of candidates) {
    const key = phoneKey(p.number);
    if (!key || known.has(key)) continue;
    known.add(key);
    addPhones.push(p);
  }
  if (addPhones.length > 0) {
    patch.phones = [...(primary.phones ?? []), ...addPhones];
  }

  // ── объекты: по адресу (или ссылке), чтобы не плодить одинаковые ──
  const addrKey = (l: Location) =>
    `${(l.address ?? "").trim().toLowerCase()}|${(l.mapUrl ?? "").trim()}`;
  const seenAddr = new Set((primary.locations ?? []).map(addrKey));
  const addLocations = (dup.locations ?? []).filter((l) => {
    const k = addrKey(l);
    if (k === "|" || seenAddr.has(k)) return false;
    seenAddr.add(k);
    return true;
  });
  if (addLocations.length > 0) {
    patch.locations = [
      ...(primary.locations ?? []),
      // Основным остаётся объект основной карточки: дубль не переставляет
      // адрес, к которому диспетчер привык.
      ...addLocations.map((l) => ({ ...l, isPrimary: false })),
    ];
  }

  // ── заметки: обе истории, свежие сверху ──
  //
  // ПОВТОРНОЕ СЛИЯНИЕ НЕ ДОЛЖНО ДУБЛИРОВАТЬ. Первая попытка могла упасть на
  // переносе визитов уже ПОСЛЕ записи патча; второй заход снова склеивал
  // массивы, и заметки дубля появлялись дважды (с теми же id — React ещё и
  // ругался на ключи в ленте истории).
  const seenNotes = new Set((primary.notes ?? []).map((n) => n.id));
  const addNotes = (dup.notes ?? []).filter((n) => !seenNotes.has(n.id));
  if (addNotes.length > 0) {
    patch.notes = [...(primary.notes ?? []), ...addNotes].sort((a, b) =>
      a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0,
    );
  }

  // ── теги ──
  const tags = new Set([...(primary.tag_ids ?? []), ...(dup.tag_ids ?? [])]);
  if (tags.size !== (primary.tag_ids ?? []).length) {
    patch.tag_ids = [...tags];
  }

  if (dup.blacklisted && !primary.blacklisted) patch.blacklisted = true;

  // БАЛАНС НЕ СКЛАДЫВАЕМ. Раньше складывали — и это ломалось дважды:
  //   • повторное слияние (после неудачи на переносе визитов) прибавляло
  //     сумму дубля ВТОРОЙ раз;
  //   • дубль уезжал в архив со своими деньгами, и «Восстановить» воскрешал
  //     ту же сумму.
  // Само поле в продукте мёртвое: приложение его не считает и не даёт
  // править, долг клиента теперь берётся только из недоплат по визитам
  // (см. clientDebt). Складывать мёртвые числа — плодить фантомы.

  return patch;
}
