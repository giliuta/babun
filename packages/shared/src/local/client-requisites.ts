import type { Client, ClientRequisites } from "./clients";

// НАБОРЫ РЕКВИЗИТОВ КЛИЕНТА — чистые правила (миграция 20260922100000).
//
// Сервер чистит массив сам (`normalize_client_requisites`), но экран должен
// показать то же самое ДО ответа: оптимистичная строка, которая через секунду
// перестраивается по-другому (второй «основной», пустой набор), — это мигание
// и повод не верить экрану. Поэтому правила здесь повторяют серверные
// один в один:
//   • пустой набор (все четыре поля пусто) выкидывается;
//   • основной ровно один: нет — первый; несколько — первый из отмеченных;
//   • у каждого набора `id`; нет или повтор — новый;
//   • VAT и рег. номер — без краёв и заглавными, как их пишут налоговая и
//     реестр;
//   • лишние ключи срезаются.

export type RequisitesFields = Pick<
  ClientRequisites,
  "legal_name" | "vat_number" | "reg_number" | "billing_address"
>;

export const REQUISITES_KEYS = [
  "legal_name",
  "vat_number",
  "reg_number",
  "billing_address",
] as const;

/** id набора, собранного из четырёх колонок строки, которая старше миграции
 *  (офлайн-кэш). Сервер примет его как обычный id при первой записи. */
export const LEGACY_REQUISITES_ID = "legacy";

const clean = (v: unknown): string | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).trim();
  return s ? s : null;
};
const upper = (v: unknown): string | null => clean(v)?.toUpperCase() ?? null;

/** Пустой набор — не набор: печатать с него нечего. */
export function isBlankRequisites(fields: Partial<RequisitesFields>): boolean {
  return REQUISITES_KEYS.every((k) => clean(fields[k]) === null);
}

export function normalizeClientRequisites(
  sets: readonly Partial<ClientRequisites>[],
  newId: () => string,
): ClientRequisites[] {
  const seen = new Set<string>();
  let defaultTaken = false;
  const out: ClientRequisites[] = [];
  for (const set of sets) {
    const fields: RequisitesFields = {
      legal_name: clean(set.legal_name),
      vat_number: upper(set.vat_number),
      reg_number: upper(set.reg_number),
      billing_address: clean(set.billing_address),
    };
    if (isBlankRequisites(fields)) continue;
    let id = clean(set.id);
    if (!id || seen.has(id)) id = newId();
    seen.add(id);
    const isDefault = !defaultTaken && set.is_default === true;
    if (isDefault) defaultTaken = true;
    out.push({ id, ...fields, is_default: isDefault });
  }
  if (!defaultTaken && out.length > 0) out[0] = { ...out[0], is_default: true };
  return out;
}

/** Наборы клиента. Строка старше миграции (кэш на устройстве) наборов не
 *  знает — тогда её четыре колонки и есть единственный, основной набор. */
export function clientRequisitesOf(
  client: Pick<Client, "requisites" | RequisitesKey> | null | undefined,
): ClientRequisites[] {
  if (!client) return [];
  if (client.requisites && client.requisites.length > 0) return client.requisites;
  const legacy: RequisitesFields = {
    legal_name: clean(client.legal_name),
    vat_number: clean(client.vat_number),
    reg_number: clean(client.reg_number),
    billing_address: clean(client.billing_address),
  };
  return isBlankRequisites(legacy)
    ? []
    : [{ id: LEGACY_REQUISITES_ID, ...legacy, is_default: true }];
}

type RequisitesKey = (typeof REQUISITES_KEYS)[number];

export function defaultRequisites(
  sets: readonly ClientRequisites[],
): ClientRequisites | null {
  return sets.find((s) => s.is_default) ?? sets[0] ?? null;
}

/** Основной первым, остальные — в своём порядке: так их показывают и блок
 *  карточки, и шторка выбора в инвойсе. */
export function orderedRequisites(
  sets: readonly ClientRequisites[],
): ClientRequisites[] {
  return [...sets].sort((a, b) => Number(b.is_default) - Number(a.is_default));
}

/** Четыре колонки-зеркало для оптимистичной строки: сервер положит туда то же
 *  самое, а поиск и «Поделиться» на устройстве читают именно их. */
export function requisitesMirror(sets: readonly ClientRequisites[]): RequisitesFields {
  const main = defaultRequisites(sets);
  return {
    legal_name: main?.legal_name ?? null,
    vat_number: main?.vat_number ?? null,
    reg_number: main?.reg_number ?? null,
    billing_address: main?.billing_address ?? null,
  };
}

/** Патч клиента: массив целиком и зеркало рядом. Сервер при правке обоих
 *  считает главным массив, так что зеркало ничего не перебивает. */
export function requisitesPatch(
  sets: readonly ClientRequisites[],
): Pick<Client, "requisites"> & RequisitesFields {
  return { requisites: [...sets], ...requisitesMirror(sets) };
}

// ─── Операции над списком (их зовёт писатель карточки) ───────────────────

/** Правка набора по id или новый набор в хвост (id нет или не найден).
 *  Первый набор клиента становится основным сам — нормализацией. */
export function upsertRequisites(
  all: readonly ClientRequisites[],
  draft: Partial<RequisitesFields> & { id?: string | null },
  newId: () => string,
): ClientRequisites[] {
  const exists = draft.id != null && all.some((s) => s.id === draft.id);
  const next: Partial<ClientRequisites>[] = exists
    ? all.map((s) => (s.id === draft.id ? { ...s, ...draft, id: s.id } : s))
    : [...all, { ...draft, id: draft.id ?? newId(), is_default: all.length === 0 }];
  return normalizeClientRequisites(next, newId);
}

/** Удаление. Снесли основной — основным становится первый оставшийся. */
export function removeRequisites(
  all: readonly ClientRequisites[],
  id: string,
  newId: () => string,
): ClientRequisites[] {
  return normalizeClientRequisites(
    all.filter((s) => s.id !== id),
    newId,
  );
}

export function makeDefaultRequisites(
  all: readonly ClientRequisites[],
  id: string,
  newId: () => string,
): ClientRequisites[] {
  if (!all.some((s) => s.id === id)) return [...all];
  return normalizeClientRequisites(
    all.map((s) => ({ ...s, is_default: s.id === id })),
    newId,
  );
}

/** Подпись набора в строке: «VAT … · Рег. …». */
export function requisitesNumbersLine(set: Partial<RequisitesFields>): string {
  return [
    clean(set.vat_number) ? `VAT ${clean(set.vat_number)}` : "",
    clean(set.reg_number) ? `Рег. ${clean(set.reg_number)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

// ─── Выбор набора в инвойсе ─────────────────────────────────────────────

/** Что ставить в инвойс: выбранный набор, пока он есть у клиента; иначе —
 *  ничего (`null` = основной, его подставит сервер). Смена клиента, удаление
 *  набора или выбор основного сводятся к `null`: колонка инвойса не должна
 *  называть то, чего нет, а основной сервер найдёт сам. */
export function resolveInvoiceRequisitesId(
  sets: readonly ClientRequisites[],
  chosenId: string | null | undefined,
): string | null {
  if (!chosenId) return null;
  const chosen = sets.find((s) => s.id === chosenId);
  if (!chosen || chosen.is_default) return null;
  return chosen.id;
}

/** Набор, который напечатается: выбранный или основной. */
export function invoiceRequisites(
  sets: readonly ClientRequisites[],
  chosenId: string | null | undefined,
): ClientRequisites | null {
  const id = resolveInvoiceRequisitesId(sets, chosenId);
  return (id ? sets.find((s) => s.id === id) : null) ?? defaultRequisites(sets);
}

/** Строке выбора в инвойсе есть что решать, только когда наборов больше
 *  одного; один или ни одного — строки нет. */
export function invoiceNeedsRequisitesChoice(sets: readonly ClientRequisites[]): boolean {
  return sets.length > 1;
}
