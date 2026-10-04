import type { Appointment } from "@babun/shared/local/appointments";
import type {
  Client,
  ClientMembership,
  ClientRequisites,
  Location,
  PhoneEntry,
} from "@babun/shared/local/clients";
import { formatCountRu } from "@babun/shared/common/utils/plural-ru";
import { clientMemberships } from "@babun/shared/local/clients";
import { clientRequisitesOf, requisitesPatch } from "@babun/shared/local/client-requisites";

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
//   • связи (`memberships`) складываются без повторов и без связи на себя;
//   • деньги (balance) НЕ складываются — почему, см. конец `mergeClientPatch`.
//
// Записи переносятся отдельно (client_id), а дубль уходит в архив, а не
// удаляется: если слили не тех, карточка на месте.
//
// ЛЮДИ ДУБЛЯ — ЗАПРЕТ, А НЕ ПЕРЕНОС (STORY-086, дыра 2). Связь живёт у члена:
// жильцы Натальи-дубля держат id дубля в СВОИХ строках. Перецелить их может
// только сервер одной транзакцией — чужих строк бывает десяток, и половина
// записанного при обрыве сети оставила бы жильцов на архивной карточке, а
// строку «жилец · (никого)» — у каждого. Функции такой нет, поэтому правило
// одно: пока у дубля есть люди, слияния нет (`mergeBlocker`).

/** ПОЧЕМУ СЛИТЬ НЕЛЬЗЯ — словами, или `null`, если можно.
 *
 *  `dupPeopleIds` — клиенты, у кого в `memberships` стоит дубль, как их
 *  отдал сервер (`useClientMembers(dup.id)`). `null` — ответа нет (грузится,
 *  упал, нет сети): неизвестное не значит «людей нет», и сливать вслепую
 *  нельзя — иначе жильцы остались бы привязаны к архивной карточке.
 *
 *  Основная карточка среди людей дубля не мешает: её связь на дубль патч
 *  снимает сам (после слияния она стала бы связью на себя). */
export function mergeBlocker(
  primary: Pick<Client, "id">,
  dup: Pick<Client, "id">,
  dupPeopleIds: readonly string[] | null,
): string | null {
  if (primary.id === dup.id) return "Это та же карточка";
  if (dupPeopleIds === null) return "Люди карточки не загрузились — объединить пока нельзя";
  const others = dupPeopleIds.filter((id) => id !== primary.id && id !== dup.id);
  // Совет — только из тех движений, что в продукте ЕСТЬ: «перенести жильца»
  // нет намеренно (ТЗ STORY-086, «что НЕ делаем» п.8), поэтому называем два
  // существующих — снять связь там и привязать здесь.
  if (others.length > 0) return "У дубля есть свои люди — уберите их там свайпом «Убрать» и привяжите здесь";
  return null;
}

/** Связи обеих карточек одним списком.
 *
 *  Связь — это пара «карточка + место»: жилец двух вилл одной управляющей —
 *  две связи, а одна и та же вилла дважды — одна. Совпавшая связь остаётся
 *  основной; роль дубля берётся, только если у основной роли нет (то же
 *  правило «дополнять, не затирать», что у скаляров).
 *
 *  Связь на себя выпадает в обе стороны: дубль, входивший в основную, и
 *  основная, входившая в дубль, — после слияния это один человек. */
function mergedMemberships(
  primary: Client,
  dup: Client,
): ClientMembership[] | undefined {
  const self = new Set([primary.id, dup.id]);
  const keyOf = (m: ClientMembership) => `${m.group_id}|${m.location_id ?? ""}`;
  const out: ClientMembership[] = [];
  const at = new Map<string, number>();
  for (const m of [...clientMemberships(primary), ...clientMemberships(dup)]) {
    if (!m.group_id || self.has(m.group_id)) continue;
    const key = keyOf(m);
    const index = at.get(key);
    if (index === undefined) {
      at.set(key, out.length);
      out.push(m);
      continue;
    }
    const kept = out[index];
    if (kept && !filled(kept.role) && filled(m.role)) {
      out[index] = { ...kept, role: m.role };
    }
  }
  const before = clientMemberships(primary);
  const same =
    out.length === before.length &&
    out.every((m, i) => m === before[i]);
  return same ? undefined : out;
}

/** ОПЛАЧЕННЫЕ ВИЗИТЫ ДУБЛЯ — ЗАПРЕТ, А НЕ ПОЛУСЛИЯНИЕ (аудит 2026-10-03).
 *
 *  Клиента у визита с живыми деньгами сервер не меняет
 *  (`protect_paid_appointment_finance`: «Сначала верните оплату…»).
 *  Слияние узнавало об этом на первом же оплаченном визите — когда патч
 *  основной уже записан, а неоплаченные визиты уже уехали: дубль оставался
 *  жив, история — разорвана надвое, и повтор упирался в ту же запись.
 *  Теперь отказ — до первой записи. Деньги — те же признаки, что держит
 *  сервер: предоплата, доплата, статус «оплачено» или «частично». */
export function paidVisitsBlocker(
  visits: readonly Pick<Appointment, "prepaid_amount" | "paid_amount" | "payment_status">[],
): string | null {
  const paid = visits.filter(
    (visit) =>
      visit.payment_status === "paid" ||
      visit.payment_status === "partial" ||
      (visit.prepaid_amount ?? 0) > 0 ||
      (visit.paid_amount ?? 0) > 0,
  ).length;
  if (paid === 0) return null;
  const count = formatCountRu(paid, ["оплаченный визит", "оплаченных визита", "оплаченных визитов"]);
  return `У дубля ${count} — клиента у них не сменить, пока оплата не возвращена. Объединить пока нельзя`;
}

/** ОБЪЕКТЫ ДВУХ КАРТОЧЕК ОДНИМ СПИСКОМ — и куда переезжают визиты.
 *
 *  Объект дубля с тем же адресом (или ссылкой), что у основной, — тот же
 *  объект: его техника и заметка дописываются к объекту основной, а визиты
 *  дубля переезжают на объект основной (`remap`). Раньше такой объект просто
 *  выпадал (аудит 2026-10-03): визиты уезжали со ссылкой на объект, которого
 *  у основной нет, «Был…» и «Пора обслужить» их не видели, техника и
 *  заметка объекта пропадали. Объект без адреса и ссылки тоже больше не
 *  выпадает — это настоящий объект со своей техникой.
 *
 *  Повторное слияние ничего не удваивает: объект с тем же id уже здесь. */
export function mergeLocations(
  primary: Client,
  dup: Client,
): { locations: Location[] | undefined; remap: Map<string, string> } {
  const keyOf = (l: Location) =>
    `${(l.address ?? "").trim().toLowerCase()}|${(l.mapUrl ?? "").trim()}`;
  const out: Location[] = [...(primary.locations ?? [])];
  const remap = new Map<string, string>();
  const ids = new Set(out.map((l) => l.id));
  const byKey = new Map<string, number>();
  out.forEach((l, index) => {
    const key = keyOf(l);
    if (key !== "|" && !byKey.has(key)) byKey.set(key, index);
  });
  let changed = false;
  for (const theirs of dup.locations ?? []) {
    if (ids.has(theirs.id)) continue;
    const key = keyOf(theirs);
    const at = key === "|" ? undefined : byKey.get(key);
    const mine = at === undefined ? undefined : out[at];
    if (at !== undefined && mine) {
      remap.set(theirs.id, mine.id);
      const unitIds = new Set((mine.equipment ?? []).map((unit) => unit.id));
      const addUnits = (theirs.equipment ?? []).filter((unit) => !unitIds.has(unit.id));
      const addNote = !filled(mine.note) && filled(theirs.note);
      if (addUnits.length > 0 || addNote) {
        out[at] = {
          ...mine,
          ...(addUnits.length > 0 ? { equipment: [...(mine.equipment ?? []), ...addUnits] } : {}),
          ...(addNote ? { note: theirs.note } : {}),
        };
        changed = true;
      }
      continue;
    }
    // Основным остаётся объект основной карточки: дубль не переставляет
    // адрес, к которому диспетчер привык.
    out.push({ ...theirs, isPrimary: false });
    ids.add(theirs.id);
    if (key !== "|") byKey.set(key, out.length - 1);
    changed = true;
  }
  return { locations: changed ? out : undefined, remap };
}

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
  const locations = mergeLocations(primary, dup).locations;
  if (locations) patch.locations = locations;

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

  // ── тег: ОДИН, как метка (владелец 22.09) — тег основной карточки
  //    главнее; своего нет — берём тег дубля. Склеивать наборы нельзя:
  //    клиент получил бы два тега, а выбор держит один. ──
  if ((primary.tag_ids ?? []).length === 0 && (dup.tag_ids ?? []).length > 0) {
    patch.tag_ids = [dup.tag_ids[0]];
  }

  // ── реквизиты: наборы дубля переезжают сюда без повторов (аудит 22.09:
  //    окно обещает «данные переедут», а наборы уходили в архив с дублем).
  //    Основной остаётся основным; сервер нормализует и зеркалит. ──
  const mine = clientRequisitesOf(primary);
  const sameSet = (a: ClientRequisites, b: ClientRequisites) =>
    (a.legal_name ?? "").trim().toLowerCase() === (b.legal_name ?? "").trim().toLowerCase() &&
    (a.vat_number ?? "").trim().toUpperCase() === (b.vat_number ?? "").trim().toUpperCase();
  const theirsSets = clientRequisitesOf(dup).filter((set) => !mine.some((m) => sameSet(m, set)));
  if (theirsSets.length > 0) {
    const merged = [
      ...mine,
      ...theirsSets.map((set) => ({
        ...set,
        // Id набора дубля — чужой; «legacy» у старой строки не уникален.
        id: `${set.id}-${dup.id.slice(0, 8)}`,
        is_default: mine.length === 0 && set.is_default,
      })),
    ];
    Object.assign(patch, requisitesPatch(merged));
  }

  if (dup.blacklisted && !primary.blacklisted) patch.blacklisted = true;

  // ── связи: обе карточки, без повторов и без связи на себя ──
  const memberships = mergedMemberships(primary, dup);
  if (memberships) patch.memberships = memberships;

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
