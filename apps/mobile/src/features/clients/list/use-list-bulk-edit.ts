import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Client, ClientTag } from "@babun/shared/local/clients";
import { listClients as listClientsCached } from "@babun/shared/sync/clientsCached";
import type { useToast } from "@/components/ui/Toast";
import { afterChoiceSheet, chooseOption } from "@/lib/choose";
import { notify } from "@/lib/notify";
import { haptics } from "@/lib/haptics";
import { writeErrorWords } from "@/lib/connection-words";
import { clientKeys } from "@/lib/client-query-keys";
import { tenantBoundClient } from "@/lib/tenant-bound-client";
import type { ClientsCapabilities, ClientsScope } from "@/session/clients-company";
import { useClientSources } from "@/features/clients/acquisition-sources";
import { bulkEditOnServer } from "@/features/clients/bulk-edit-rpc";
import {
  applyBulkEdit,
  bulkResultWords,
  bulkSourceOptions,
  bulkTagsOffered,
  sourceEdits,
  splitByRight,
  tagEdits,
  teamEdits,
  undoEdits,
  type BulkEdit,
  type BulkField,
  type BulkTagMode,
} from "@/features/clients/bulk-edit";

/** Какая шторка пачки открыта и над кем: набор снят в момент открытия, чтобы
 *  выбор, поменявшийся под шторкой, не изменил адресатов. */
export type BulkSheet =
  | { kind: "tags"; mode: BulkTagMode; clients: Client[]; refused: number }
  | { kind: "team"; clients: Client[]; refused: number }
  | { kind: "source"; clients: Client[]; refused: number };

const NO_RIGHT: Record<BulkField, string> = {
  tags: "Нет права менять теги у выбранных",
  team: "Нет права менять команду у выбранных",
  source: "Нет права менять источник у выбранных",
};

/** ТЕГИ, КОМАНДА И ИСТОЧНИК ВЫБРАННЫМ. Шторки — те же, что у карточки;
 *  запись — одним вызовом сервера; итог — тост с числом и «Отменить». */
export function useListBulkEdit({
  scope,
  caps,
  selectedClients,
  tags,
  ownTeams,
  toast,
  exitSelection,
}: {
  scope: ClientsScope | null;
  caps: ClientsCapabilities;
  selectedClients: Client[];
  tags: ClientTag[];
  ownTeams: readonly { id: string }[];
  toast: ReturnType<typeof useToast>;
  exitSelection: () => void;
}) {
  const qc = useQueryClient();
  const { data: sources = [] } = useClientSources();
  const [bulkSheet, setBulkSheetState] = useState<BulkSheet | null>(null);
  // Адресаты последней открытой шторки. Выбор в `PickerSheet` срабатывает
  // уже после закрытия (ждёт, пока окно снимут), когда состояние шторки
  // пусто, — поэтому применение читает снимок отсюда.
  const opened = useRef<BulkSheet | null>(null);
  const setBulkSheet = (sheet: BulkSheet | null) => {
    if (sheet) opened.current = sheet;
    setBulkSheetState(sheet);
  };
  const [bulkBusy, setBulkBusy] = useState(false);
  const tenantId = scope?.tenantId ?? null;
  // Клиент компании без команд читает источники и теги первой — как карточка.
  const fallbackTeam = ownTeams[0]?.id ?? null;

  // Дверь пачки есть у того, кто правит карточки; у кого из выбранных правка
  // положена — решает право по полю у каждого (`canBulkEdit`).
  const canTags = caps.edit;
  const canSource = caps.edit;
  // Команду выбирать не из чего, пока она одна.
  const canTeam = caps.edit && ownTeams.length > 1;

  /** Выбранные с правом на поле; без права ни у кого — отказ словами. */
  const pickAllowed = (field: BulkField) => {
    const { allowed, refused } = splitByRight(selectedClients, field, caps.edit);
    if (allowed.length === 0) {
      haptics.error();
      toast(NO_RIGHT[field], "error");
      return null;
    }
    return { allowed, refused };
  };

  /** Строки списка и карточки — с правкой сразу, не дожидаясь перечитки. */
  const patchCache = (edits: readonly BulkEdit[], ids: ReadonlySet<string>) => {
    const byId = new Map(edits.map((e) => [e.id, e]));
    qc.setQueriesData<Client[]>({ queryKey: clientKeys.all() }, (list) =>
      Array.isArray(list)
        ? list.map((c) => {
            const edit = byId.get(c.id);
            return edit && ids.has(c.id) ? applyBulkEdit(c, edit) : c;
          })
        : list,
    );
    void qc.invalidateQueries({ queryKey: clientKeys.cardAll() });
    // Перечитка кэша телефона: список живёт из SQLite, и без неё следующее
    // чтение вернуло бы снимок до правки. Обёртка отдаёт снимок и сверяет
    // его с сервером в фоне; изменение доезжает до экрана сигналом.
    if (tenantId) void listClientsCached(tenantBoundClient(tenantId), tenantId).catch(() => {});
  };

  /** Отказ, после которого выбор остаётся: человек повторит, когда сможет. */
  const refuse = (kind: "offline" | "not_deployed" | "failed", error?: unknown) => {
    haptics.error();
    if (kind === "offline") {
      notify(
        "Нужна сеть",
        "Теги, команда и источник сразу многим ставятся только при связи с сервером. Подключитесь и повторите.",
      );
    } else if (kind === "not_deployed") {
      notify(
        "Пока недоступно",
        "Правка сразу многих клиентов заработает после обновления сервера. По одному — в карточке клиента.",
      );
    } else {
      const words = writeErrorWords(error, {
        failed: "Не удалось изменить",
        notDone: "Клиенты не изменены",
      });
      notify(words.title, words.subtitle);
    }
  };

  const undo = async (edits: BulkEdit[]) => {
    if (!tenantId || edits.length === 0) return;
    const out = await bulkEditOnServer(tenantId, edits);
    if (out.kind !== "done") {
      refuse(out.kind, out.kind === "failed" ? out.error : undefined);
      return;
    }
    patchCache(edits, new Set(out.result.changed.map((c) => c.id)));
    haptics.success();
    toast(
      out.result.skipped > 0
        ? `Вернули не всех — не удалось: ${out.result.skipped}`
        : "Вернули как было",
      out.result.skipped > 0 ? "error" : "success",
    );
  };

  const run = async (
    field: BulkField,
    mode: BulkTagMode,
    edits: BulkEdit[],
    skippedBefore: number,
  ) => {
    if (!tenantId || bulkBusy) return;
    setBulkBusy(true);
    try {
      const out = await bulkEditOnServer(tenantId, edits);
      if (out.kind !== "done") {
        refuse(out.kind, out.kind === "failed" ? out.error : undefined);
        return;
      }
      const { result } = out;
      const changedIds = new Set(result.changed.map((c) => c.id));
      patchCache(edits, changedIds);
      const words = bulkResultWords(field, mode, changedIds.size, skippedBefore + result.skipped);
      const back = undoEdits(result);
      if (words.tone === "error") haptics.error();
      else haptics.success();
      toast(
        words.message,
        words.tone,
        back.length > 0 ? { label: "Отменить", onPress: () => void undo(back) } : undefined,
      );
      exitSelection();
    } finally {
      setBulkBusy(false);
    }
  };

  const openTags = async () => {
    const pick = pickAllowed("tags");
    if (!pick) return;
    const choice = await chooseOption(`Теги выбранным: ${pick.allowed.length}`, [
      { label: "Поставить теги" },
      { label: "Убрать теги", destructive: true },
    ]);
    if (choice === null) return;
    const mode: BulkTagMode = choice === 0 ? "add" : "remove";
    if (bulkTagsOffered(tags, pick.allowed, mode, fallbackTeam).length === 0) {
      toast(mode === "remove" ? "У выбранных нет тегов" : "Тегов пока нет — заведите их в настройках клиентов", "info");
      return;
    }
    // Шторка тегов — своё окно: ждём, пока вопрос уедет целиком.
    await afterChoiceSheet();
    setBulkSheet({ kind: "tags", mode, clients: pick.allowed, refused: pick.refused });
  };
  const openTeam = () => {
    const pick = pickAllowed("team");
    if (pick) setBulkSheet({ kind: "team", clients: pick.allowed, refused: pick.refused });
  };
  const openSource = () => {
    const pick = pickAllowed("source");
    if (pick) setBulkSheet({ kind: "source", clients: pick.allowed, refused: pick.refused });
  };

  const applyTags = (ids: string[]) => {
    const sheet = opened.current;
    if (sheet?.kind !== "tags" || ids.length === 0) return;
    void run("tags", sheet.mode, tagEdits(sheet.clients, sheet.mode, ids), sheet.refused);
  };
  const applyTeam = (teamId: string | null) => {
    const sheet = opened.current;
    if (sheet?.kind !== "team" || !teamId) return;
    void run("team", "add", teamEdits(sheet.clients, teamId), sheet.refused);
  };
  const applySource = (key: string) => {
    const sheet = opened.current;
    if (sheet?.kind !== "source") return;
    const { edits, missing } = sourceEdits(sheet.clients, sources, key, fallbackTeam);
    void run("source", "add", edits, sheet.refused + missing);
  };

  const sheetTags =
    bulkSheet?.kind === "tags"
      ? bulkTagsOffered(tags, bulkSheet.clients, bulkSheet.mode, fallbackTeam)
      : [];
  const sheetSources =
    bulkSheet?.kind === "source" ? bulkSourceOptions(sources, bulkSheet.clients, fallbackTeam) : [];
  // Все выбранные уже в одной команде — она отмечена в шторке.
  const sheetTeam =
    bulkSheet?.kind === "team" &&
    bulkSheet.clients.every((c) => c.team_id === bulkSheet.clients[0]?.team_id)
      ? (bulkSheet.clients[0]?.team_id ?? null)
      : null;

  return {
    bulkSheet,
    closeBulkSheet: () => setBulkSheet(null),
    bulkBusy,
    canTags,
    canTeam,
    canSource,
    openTags: () => void openTags(),
    openTeam,
    openSource,
    applyTags,
    applyTeam,
    applySource,
    sheetTags,
    sheetSources,
    sheetTeam,
  };
}
