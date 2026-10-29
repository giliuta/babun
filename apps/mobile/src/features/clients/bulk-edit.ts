import type { Client, ClientTag } from "@babun/shared/local/clients";
import { clientBlockLevel } from "./client-block-access";
import {
  customSourceValue,
  sourceDisplayName,
  teamSources,
  type ClientSource,
} from "./acquisition-source";

// ТЕГИ, КОМАНДА И ИСТОЧНИК СРАЗУ МНОГИМ — правила без React.
//
// Пачка уходит на сервер ОДНИМ вызовом (`bulk_edit_clients`): список правок
// по клиенту. Здесь — кому из выбранных правка вообще положена, какие правки
// собрать и как их отменить. Сервер решает то же самое сам (теми же дверьми,
// что карточка), экран лишь не шлёт заведомый отказ и называет его числом.
//
// Лист без React — проверяется тестом напрямую.

export type BulkField = "tags" | "team" | "source";
export type BulkTagMode = "add" | "remove";

/** Правка одного клиента — ровно поля `bulk_edit_clients`. */
export interface BulkEdit {
  id: string;
  add_tags?: string[];
  remove_tags?: string[];
  /** Набор целиком — только отмена. */
  tag_ids?: string[];
  team_id?: string;
  acquisition_source?: string;
}

/** Ответ сервера: кого изменили и что у них было до. */
export interface BulkEditResult {
  changed: {
    id: string;
    before: { tag_ids?: string[]; team_id?: string | null; acquisition_source?: string };
  }[];
  skipped: number;
  unchanged: number;
}

/** МОЖНО ЛИ ПОМЕНЯТЬ ЭТО ПОЛЕ У КЛИЕНТА — как пустит сервер.
 *  Строка без `blocks` — своя база владельца: всё открыто. У строки
 *  сотрудника тег — блок «Тег», источник — блок «Личное», а команда — база
 *  клиента, которую сотрудник только видит. */
export function canBulkEdit(
  client: Pick<Client, "blocks">,
  field: BulkField,
  canEdit: boolean,
): boolean {
  if (!canEdit) return false;
  if (!client.blocks) return true;
  if (field === "tags") return clientBlockLevel(client, "clients.tags") === "write";
  if (field === "source") return clientBlockLevel(client, "clients.personal") === "write";
  return false;
}

/** Выбранные, кому правка положена, и сколько пропущено по праву. */
export function splitByRight<C extends Pick<Client, "blocks">>(
  clients: readonly C[],
  field: BulkField,
  canEdit: boolean,
): { allowed: C[]; refused: number } {
  const allowed = clients.filter((c) => canBulkEdit(c, field, canEdit));
  return { allowed, refused: clients.length - allowed.length };
}

/** Команда клиента; у компании без команд — первая (как карточка). */
function teamOf(client: Pick<Client, "team_id">, fallbackTeam: string | null): string | null {
  return client.team_id ?? fallbackTeam;
}

/** ТЕГИ В ШТОРКЕ. «Поставить» — теги команд выбранных и общие (без команды),
 *  без скрытых: сотруднику сервер чужой команды тег не даст. «Снять» — только
 *  те, что хоть у кого-то из выбранных стоят: снимать нечего — строки нет.
 *  Порядок — каталога. */
export function bulkTagsOffered(
  tags: readonly ClientTag[],
  clients: readonly Pick<Client, "team_id" | "tag_ids">[],
  mode: BulkTagMode,
  fallbackTeam: string | null,
  /** Календари в архиве: их теги не ставятся (`serving-teams.ts`). Снять
   *  уже стоящий — можно. */
  archivedTeamIds: ReadonlySet<string> = new Set(),
): ClientTag[] {
  if (mode === "remove") {
    const present = new Set(clients.flatMap((c) => c.tag_ids ?? []));
    return tags.filter((tag) => present.has(tag.id));
  }
  const teams = new Set(clients.map((c) => teamOf(c, fallbackTeam)));
  return tags.filter(
    (tag) =>
      !tag.hidden &&
      (!tag.team_id || (teams.has(tag.team_id) && !archivedTeamIds.has(tag.team_id))),
  );
}

export function tagEdits(
  clients: readonly Pick<Client, "id">[],
  mode: BulkTagMode,
  tagIds: readonly string[],
): BulkEdit[] {
  const key = mode === "add" ? "add_tags" : "remove_tags";
  return clients.map((c) => ({ id: c.id, [key]: [...tagIds] }));
}

export function teamEdits(clients: readonly Pick<Client, "id">[], teamId: string): BulkEdit[] {
  return clients.map((c) => ({ id: c.id, team_id: teamId }));
}

/** Вариант источника в шторке — ИМЯ: у каждой команды своя строка
 *  «Instagram», а выбранные бывают из разных команд. */
export interface BulkSourceOption {
  key: string;
  label: string;
  /** Строка-образец для значка (засеянная — свой значок). */
  source: ClientSource;
}

function nameKey(source: Pick<ClientSource, "name">): string {
  return source.name.trim().toLowerCase();
}

/** Имена источников команд выбранных, в порядке справочника: сперва команда
 *  первого выбранного, следом недостающие имена остальных команд. */
export function bulkSourceOptions(
  sources: readonly ClientSource[],
  clients: readonly Pick<Client, "team_id">[],
  fallbackTeam: string | null,
): BulkSourceOption[] {
  const teams = [...new Set(clients.map((c) => teamOf(c, fallbackTeam)))];
  const seen = new Set<string>();
  const out: BulkSourceOption[] = [];
  for (const team of teams) {
    for (const s of teamSources([...sources], team)) {
      const key = nameKey(s);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ key, label: sourceDisplayName(s), source: s });
    }
  }
  return out;
}

/** ИСТОЧНИК КАЖДОМУ — СТРОКОЙ ЕГО КОМАНДЫ с выбранным именем. У команды
 *  такого имени нет — клиент пропускается (`missing`), а не получает чужую
 *  строку: источник другой команды карточка прочла бы как «не указан». */
export function sourceEdits(
  clients: readonly Pick<Client, "id" | "team_id">[],
  sources: readonly ClientSource[],
  key: string,
  fallbackTeam: string | null,
): { edits: BulkEdit[]; missing: number } {
  const edits: BulkEdit[] = [];
  let missing = 0;
  for (const c of clients) {
    const team = teamOf(c, fallbackTeam);
    const row = sources.find((s) => s.team_id === team && nameKey(s) === key);
    if (row) edits.push({ id: c.id, acquisition_source: customSourceValue(row.id) });
    else missing += 1;
  }
  return { edits, missing };
}

/** ОТМЕНА — КАЖДОМУ ЕГО ПРЕЖНЕЕ: ровно поля, которые сервер изменил. Команды
 *  «никакой» вернуть нельзя (сервер команду не снимает) — такое поле
 *  отмена не шлёт. */
export function undoEdits(result: BulkEditResult): BulkEdit[] {
  return result.changed.flatMap(({ id, before }) => {
    const edit: BulkEdit = { id };
    if (before.tag_ids) edit.tag_ids = [...before.tag_ids];
    if (typeof before.team_id === "string") edit.team_id = before.team_id;
    if (typeof before.acquisition_source === "string") {
      edit.acquisition_source = before.acquisition_source;
    }
    return Object.keys(edit).length > 1 ? [edit] : [];
  });
}

/** Ответ сервера в известной форме; чужое — как «никого не изменили». */
export function parseBulkEditResult(raw: unknown): BulkEditResult {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const changed = Array.isArray(obj.changed)
    ? obj.changed.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as { id?: unknown; before?: unknown };
        if (typeof row.id !== "string") return [];
        const before = (row.before && typeof row.before === "object" ? row.before : {}) as BulkEditResult["changed"][number]["before"];
        return [{ id: row.id, before }];
      })
    : [];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return { changed, skipped: num(obj.skipped), unchanged: num(obj.unchanged) };
}

/** Новые значения клиента после правки — для строки списка до перечитки. */
export function applyBulkEdit<C extends Pick<Client, "tag_ids" | "team_id" | "acquisition_source">>(
  client: C,
  edit: BulkEdit,
): C {
  let tags = client.tag_ids ?? [];
  if (edit.tag_ids) tags = [...edit.tag_ids];
  if (edit.add_tags) tags = [...tags, ...edit.add_tags.filter((id) => !tags.includes(id))];
  if (edit.remove_tags) tags = tags.filter((id) => !edit.remove_tags?.includes(id));
  return {
    ...client,
    tag_ids: tags,
    ...(edit.team_id !== undefined ? { team_id: edit.team_id } : {}),
    ...(edit.acquisition_source !== undefined
      ? { acquisition_source: edit.acquisition_source as C["acquisition_source"] }
      : {}),
  };
}

/** Тост итога: что сделано и сколько пропущено. */
export function bulkResultWords(
  field: BulkField,
  mode: BulkTagMode,
  changed: number,
  skipped: number,
): { message: string; tone: "success" | "error" | "info" } {
  const tail = skipped > 0 ? ` · пропущено: ${skipped}` : "";
  if (changed === 0) {
    return skipped > 0
      ? { message: `Не изменено — пропущено: ${skipped}`, tone: "error" }
      : { message: "У выбранных уже так", tone: "info" };
  }
  const done =
    field === "team"
      ? `Команда сменена: ${changed}`
      : field === "source"
        ? `Источник поставлен: ${changed}`
        : mode === "add"
          ? `Теги поставлены: ${changed}`
          : `Теги сняты: ${changed}`;
  return { message: done + tail, tone: "success" };
}
