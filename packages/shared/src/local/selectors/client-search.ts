// Client search helpers. Single-place definition so ClientPickerSheet,
// /dashboard/clients, and any future search surface all match clients
// exactly the same way.
//
// Requirements:
//   * Case-insensitive, punctuation-insensitive.
//   * Greek / Cyrillic / Latin names that sound the same must match
//     across scripts ("Иван" / "Ivan" / "Iван" all hit each other).
//     AirFix clientele includes locals, Russian expats, and Cypriot
//     Greek names; one search bar has to find them all.
//   * Address matches too — dispatcher often remembers the street,
//     not the name.
//   * Phone search ignores spaces, dashes, parentheses.

import type { Client } from "../clients";

const RU_TO_LAT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sh",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  // Украинские буквы: без них «Олексій» терял «і» и не
  // находился ни по «Oleksii», ни по «Олексии».
  і: "i", ї: "i", є: "e", ґ: "g",
  // Латиница без разложения NFD: турецкая «ı» (кипрские турецкие имена —
  // «Işık» не находился по «isik»), польская «ł», «đ», немецкая «ß».
  ı: "i", ł: "l", đ: "d", ß: "ss",
};

const GR_TO_LAT: Record<string, string> = {
  α: "a", β: "b", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th",
  ι: "i", κ: "k", λ: "l", μ: "m", ν: "n", ξ: "x", ο: "o", π: "p", ρ: "r",
  σ: "s", ς: "s", τ: "t", υ: "y", φ: "f", χ: "h", ψ: "ps", ω: "o",
  // Ударение и диерезис — та же буква: ударная выпадала из
  // поиска целиком, и «Γιάννης» не находился ни по «Γιαννης», ни по
  // «ΓΙΑΝΝΗΣ». Обычно знак снимает `stripMarks`; таблица — на случай движка
  // без `normalize`, греческие имена — главные у кипрских клиентов.
  ά: "a", έ: "e", ή: "i", ί: "i", ϊ: "i", ΐ: "i", ό: "o", ύ: "y", ϋ: "y",
  ΰ: "y", ώ: "o",
};

function transliterate(input: string): string {
  let out = "";
  for (const ch of input) {
    out += RU_TO_LAT[ch] ?? GR_TO_LAT[ch] ?? ch;
  }
  return out;
}

/** Снять диакритику: «José» → «jose», «Müller» → «muller». Буква и знак
 *  разделяются (NFD), знак уходит. */
function stripMarks(input: string): string {
  try {
    return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch {
    return input;
  }
}

function normalizeDigits(input: string): string {
  return input.replace(/\D/g, "");
}

/** ГРУБЫЙ КЛЮЧ ЗВУЧАНИЯ — одинаковый для запроса и для клиента. Побуквенная
 *  транслитерация даёт «Λουκάς» → «loykas», а человек набирает «Loukas»;
 *  «Андрей» → «andrei», а в паспорте «Andrey»; «Χρίστος» → «hristos», а
 *  «Christos» — «christos». Сводим обе стороны к одному ключу: лишнее
 *  совпадение в поиске дешевле, чем ненайденный клиент. */
function foldSound(latin: string): string {
  return latin
    .replace(/ph/g, "f")
    .replace(/[kc]h/g, "h")
    .replace(/t[sz]/g, "c")
    .replace(/x/g, "ks")
    .replace(/c/g, "k")
    .replace(/o[uy]/g, "u")
    .replace(/[yj]/g, "i")
    .replace(/([a-z])\1+/g, "$1");
}

function normalizeSearchable(input: string): string {
  // Lower-case + strip everything that isn't a letter or digit; also
  // transliterate Cyrillic/Greek so "Ivan" and "Иван" hit the same
  // normalised form.
  const lower = stripMarks(input.toLowerCase());
  const translit = transliterate(lower);
  return foldSound(translit.replace(/[^a-z0-9]/g, ""));
}

/** Буквально, без транслита и «звучания»: заметка «Ivan» не должна ловить
 *  запрос «Иван» — транслит нужен имени и адресу, которые пишут кто как. */
function normalizePlain(input: string): string {
  return stripMarks(input.toLowerCase()).replace(/[^\p{L}\p{N}]/gu, "");
}

interface Haystacks {
  /** Имя и адрес — с транслитом и ключом звучания. */
  normalized: string[];
  /** Остальные поля — буквально. */
  plain: string[];
  /** Цифры номеров и прочих полей, от 4 цифр. */
  digits: string[];
  /** Цифры номеров телефона — для номера, набранного с кодом страны. */
  phones: string[];
}

function clientHaystacks(client: Client): Haystacks {
  const normalized: string[] = [];
  const plain: string[] = [];
  const digits: string[] = [];
  const phones: string[] = [];
  const pushDigits = (s: string) => {
    const d = normalizeDigits(s);
    if (d.length >= 4) digits.push(d);
  };
  // ТРАНСЛИТ — ТОЛЬКО ИМЕНИ И АДРЕСУ: их пишут то кириллицей, то латиницей.
  const pushName = (s: string | null | undefined) => {
    if (!s) return;
    normalized.push(normalizeSearchable(s));
    pushDigits(s);
  };
  const push = (s: string | null | undefined) => {
    if (!s) return;
    plain.push(normalizePlain(s));
    pushDigits(s);
  };
  const pushPhone = (s: string | null | undefined) => {
    if (!s) return;
    push(s);
    const d = normalizeDigits(s);
    if (d.length >= 6) phones.push(d);
  };
  pushName(client.full_name);
  pushPhone(client.phone);
  // Канонический номер: у клиентов из CSV и контактов `phone`
  // лежит без кода страны, а строка списка показывает номер с ним — вставка
  // показанного «+357 99 123 456» в поиск не находила того же клиента.
  pushPhone(client.phone_e164);
  push(client.email);
  pushName(client.sms_name);
  pushPhone(client.whatsapp_phone);
  push(client.telegram_username);
  push(client.instagram_username);
  push(client.comment);
  pushName(client.address);
  // Метка — название места, как адрес: «Limassol» находит «Лимассол».
  pushName(client.city);
  // STORY-085: клиент находится по реквизитам — юридическому имени и VAT.
  // Люди карточки — сами клиенты и находятся своими строками.
  pushName(client.legal_name);
  push(client.vat_number);
  // …и по ВСЕМ наборам, а не только по основному-зеркалу (у
  // компании два набора, иначе поиск по VAT второго клиента не находил).
  for (const set of client.requisites ?? []) {
    pushName(set.legal_name);
    push(set.vat_number);
    push(set.reg_number);
  }
  for (const note of client.notes ?? []) push(note.text);
  for (const p of client.phones ?? []) {
    pushPhone(p.number);
    pushName(p.name);
    push(p.label);
  }
  for (const unit of client.equipment ?? []) {
    push(unit.room);
    push(unit.brand);
    push(unit.model);
  }
  for (const loc of client.locations ?? []) {
    pushName(loc.address);
    push(loc.label);
    push(loc.note);
    for (const unit of loc.equipment ?? []) {
      push(unit.room);
      push(unit.brand);
      push(unit.model);
    }
  }
  return { normalized, plain, digits, phones };
}

/** В запросе нет ни буквы, ни цифры («+», «(») — искать нечего: список
 *  остаётся целым, а не пустеет на первом знаке номера. */
function isEmptyQuery(q: string): boolean {
  return normalizePlain(q).length === 0;
}

/** `extra` — чужие слова, по которым клиента тоже находят: имя карточки, в
 *  которую он входит, его роль и место («Наталья», «жилец», «Вилла 5»).
 *  Жильцов управляющей ищут по её имени — «Наталья» в поиске
 *  обязана приводить и к ней, и к людям её карточки. Слова приходят снаружи:
 *  сам клиент знает только id карточки, имя — у списка. */
export function matchesClient(
  client: Client,
  rawQuery: string,
  extra: readonly string[] = [],
): boolean {
  const q = rawQuery.trim();
  if (!q || isEmptyQuery(q)) return true;

  // Cache-worthy per call: we stringify the client haystacks once per
  // invocation. The caller loops through `clients` so keeping this here
  // is fine — it's not a hot path compared to a proper index yet.
  const hay = clientHaystacks(client);
  const extraNorm = extra.map(normalizeSearchable);
  if (matchesPiece(q, hay, extraNorm)) return true;

  // СЛОВА ПО ОТДЕЛЬНОСТИ. Запрос склеивался в одну строку, и
  // «Иван Сидоров» не находил «Иван Петрович Сидоров», а «Петров Иван» —
  // «Иван Петров». Теперь, если целиком не нашлось, каждое слово обязано
  // найтись где-то у клиента (имя, город, номер — в любом поле).
  const words = q.split(/\s+/).filter((w) => normalizePlain(w).length > 0);
  if (words.length < 2) return false;
  return words.every((w) => matchesPiece(w, hay, extraNorm));
}

/**
 * НАСКОЛЬКО ПРЯМО ЗАПРОС ПОПАЛ В КЛИЕНТА — для порядка найденного.
 *
 * 0 — имя начинается с запроса или номер содержит набранные цифры;
 * 1 — запрос (или каждое его слово) есть в имени;
 * 2 — нашёлся по другим полям: метке, адресу, заметке, реквизитам.
 *
 * Без порядка поиск «Тест» в шторке выбора ставил четырёх клиентов с меткой
 * «Test» выше самого «Тест Календарь» — нужный оказывался последним, под
 * кнопкой Внутри одной ступени порядок прежний.
 */
export function clientSearchRank(client: Client, rawQuery: string): 0 | 1 | 2 {
  const q = rawQuery.trim();
  if (!q || isEmptyQuery(q)) return 2;
  const name = normalizeSearchable(client.full_name ?? "");
  const qNorm = normalizeSearchable(q);
  const qDigits = normalizeDigits(q);
  if (qNorm && name.startsWith(qNorm)) return 0;
  if (qDigits.length >= 4) {
    for (const phone of [client.phone, client.phone_e164, ...(client.phones ?? []).map((p) => p.number)]) {
      if (phone && normalizeDigits(phone).includes(qDigits)) return 0;
    }
  }
  if (qNorm && name.includes(qNorm)) return 1;
  const words = q.split(/\s+/).map(normalizeSearchable).filter((w) => w.length > 0);
  if (words.length > 1 && words.every((w) => name.includes(w))) return 1;
  return 2;
}

/** Найденные — по `clientSearchRank`, внутри ступени порядок сохраняется. */
export function rankClientMatches<T extends Client>(list: readonly T[], rawQuery: string): T[] {
  if (!rawQuery.trim() || isEmptyQuery(rawQuery)) return [...list];
  return list
    .map((c, i) => ({ c, i, r: clientSearchRank(c, rawQuery) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.c);
}

function matchesPiece(
  piece: string,
  hay: Haystacks,
  extraNorm: readonly string[],
): boolean {
  const qNorm = normalizeSearchable(piece);
  const qPlainText = normalizePlain(piece);
  // ЦИФРЫ ИЩУТСЯ ТОЛЬКО В ЗАПРОСЕ БЕЗ БУКВ. «Makarios 8020» — это адрес, и
  // «8020» из него не должен ловить каждого, у кого 8020 в номере: слово
  // «8020» отдельно ищется ниже, вместе с «Makarios».
  const hasLetters = /\p{L}/u.test(piece);
  const qDigits = hasLetters ? "" : normalizeDigits(piece);
  // «00» — тот же международный выход, что «+»: номер, вставленный как
  // «0035799123456», не находил «+357 99 123 456».
  const qPlain = qDigits.length >= 10 && qDigits.startsWith("00") ? qDigits.slice(2) : qDigits;
  // Один ведущий «0» — местный формат («07700 900123»), а в базе номер с кодом
  // страны («+44 7700 900123»). Без нуля это ХВОСТ номера: только конец, чтобы
  // «0» + цифры из середины чужого номера совпадением не стали.
  const qLocal =
    qDigits.length >= 9 && qDigits.startsWith("0") && !qDigits.startsWith("00")
      ? qDigits.slice(1)
      : null;
  if (qDigits.length >= 4) {
    for (const d of hay.digits) {
      if (d.includes(qDigits) || d.includes(qPlain)) return true;
      if (qLocal && d.endsWith(qLocal)) return true;
    }
    // НОМЕР С КОДОМ СТРАНЫ находит номер, сохранённый без кода: «+357 99 123
    // 456» — доп. номер «99 123 456» того же человека.
    for (const d of hay.phones) {
      if (d.length >= 7 && qPlain.length > d.length && qPlain.endsWith(d)) return true;
    }
  }
  if (qNorm.length > 0) {
    for (const s of hay.normalized) {
      if (s.includes(qNorm)) return true;
    }
  }
  if (qPlainText.length > 0) {
    for (const s of hay.plain) {
      if (s.includes(qPlainText)) return true;
    }
  }
  if (qNorm.length === 0) return false;
  for (const word of extraNorm) {
    if (word.includes(qNorm)) return true;
  }
  return false;
}
