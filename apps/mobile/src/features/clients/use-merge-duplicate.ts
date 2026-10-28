import { useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Client } from "@babun/shared/local/clients";
import { useClientAppointments } from "@/features/clients/appointments";
import { useClientsScopeOrNull } from "@/session/company-scope";
import {
  duplicateQueryKeyPrefix,
  useDuplicateOf,
} from "@/features/clients/DuplicateNotice";
import {
  mergeBlocker,
  mergeClientPatch,
  mergeLocations,
  paidVisitsBlocker,
  teamTagIds,
} from "@/features/clients/merge-clients";
import {
  useClient,
  useClientTags,
  useClientsSourceScope,
} from "@/features/clients/queries";
import { useClientMembers } from "@/features/clients/use-client-links";
import { clientMembersQueryKey, parseLinkKey } from "@/features/clients/use-link-writer";
import { useToast } from "@/components/ui/Toast";
import { confirmThen } from "@/lib/confirm";
import { haptics } from "@/lib/haptics";
import { useTenantId } from "@/lib/tenant";
import { clientKeys } from "@/lib/client-query-keys";
import { mergeClientsOnServer } from "@/features/clients/merge-clients-rpc";

// «ОБЪЕДИНИТЬ С ДУБЛЕМ» — ПУНКТ «⋯» КАРТОЧКИ.
//
// Кнопки в плашке дубля нет: внутри содержимого кнопок не бывает, и слияние
// живёт в меню к остальным необратимым. Дубль —
// тот же, что называет плашка (`useDuplicateOf`, один ключ, один запрос).
//
// СЛИВАЕТ СЕРВЕР ОДНИМ ВЫЗОВОМ (`merge-clients-rpc.ts`): правка основной,
// визиты, «Удалённые записи», файлы, долги и корзина дубля — одна транзакция.
// Отказ сервера (оплаченные визиты, не владелец) — тостом словами.

interface MergeDuplicateInput {
  /** Карточка страницы; черновик и архив пункта не получают. */
  client: Client | undefined;
  isDraft: boolean;
  /** Хозяйство базы (`caps.manage`) — то же право, что было у кнопки. */
  canManage: boolean;
  closeMenu: () => void;
}

/** Id людей дубля для `mergeBlocker`. `null` — ответа нет: неизвестное не
 *  значит «людей нет». Функции связей на сервере ещё нет — у владельца это
 *  «связей не бывает» (`[]`), у остальных набор мог быть закрыт правом. */
function peopleIdsOf(
  members: ReturnType<typeof useClientMembers>,
  isOwner: boolean,
): string[] | null {
  if (members.isLoading || members.isError) return null;
  if (members.unavailable) return isOwner ? [] : null;
  return members.data
    .map((item) => parseLinkKey(item.key)?.memberId)
    .filter((id): id is string => !!id);
}

function freshestClient(qc: QueryClient, id: string): Client | null {
  let best: { at: number; client: Client } | null = null;
  for (const query of qc.getQueryCache().findAll({ queryKey: clientKeys.card(id) })) {
    const client = query.state.data as Client | null | undefined;
    if (!client || client.id !== id) continue;
    if (!best || query.state.dataUpdatedAt > best.at) best = { at: query.state.dataUpdatedAt, client };
  }
  return best?.client ?? null;
}

/** Обработчик пункта «Объединить с дублем» или `undefined` — пункта нет. */
export function useMergeDuplicate({
  client,
  isDraft,
  canManage,
  closeMenu,
}: MergeDuplicateInput): (() => void) | undefined {
  const toast = useToast();
  const qc = useQueryClient();
  const scope = useClientsScopeOrNull();
  const sourceScope = useClientsSourceScope();
  const activeTenantId = useTenantId();
  const tenantId = scope?.tenantId ?? activeTenantId;
  // Сервер сливает под АКТИВНОЙ компанией (заголовок запроса): своя база,
  // открытая не в календаре, ушла бы под чужой заголовок.
  const eligible =
    !!client && !isDraft && !client.deleted_at && canManage && (scope?.isActive ?? true);
  const dupId = useDuplicateOf(eligible ? client : null);
  const dup = useClient(dupId ?? "").data ?? null;
  const members = useClientMembers(dupId);
  const dupAppts = useClientAppointments(dupId ?? "");
  const tagsQuery = useClientTags();
  const running = useRef(false);

  if (!eligible || !client || !dupId) return undefined;
  const primary = client;

  const merge = async (dupRow: Client) => {
    // Засов рефом, а не состоянием: два тапа в одном кадре оба видели бы
    // «свободно» и слили бы дважды — заметки удвоились бы.
    if (running.current) return;
    running.current = true;
    try {
      // Карточку берём СВЕЖУЮ из кэша: патч перезаписывает массивы (номера,
      // объекты, заметки, связи) целиком, и снимок с момента открытия
      // страницы затёр бы номер, добавленный секунду назад. Ключ карточки
      // длиннее id — ["client", id, компания, вид], — и точный
      // `getQueryData(["client", id])` не находит ничего: слияние всегда
      // брало бы снимок. Берём самый свежий из совпавших по началу ключа.
      const fresh = freshestClient(qc, primary.id) ?? primary;
      // Справочник не загрузился — теги дубля берём как есть, а не теряем.
      const allowedTags = tagsQuery.data ? teamTagIds(tagsQuery.data, fresh.team_id) : null;
      const patch = mergeClientPatch(fresh, dupRow, allowedTags);
      // Объект дубля, совпавший с объектом основной, уходит в него — и
      // визиты на нём переезжают на объект основной.
      const { remap } = mergeLocations(fresh, dupRow);
      await mergeClientsOnServer({ primaryId: primary.id, duplicateId: dupRow.id, patch, remap });
      // Сервер переписал строки мимо кэша телефона: визиты, файлы, долги и
      // «Удалённые записи» перечитываются, дубль уходит из списка.
      for (const key of [
        clientKeys.all(),
        clientKeys.cardAll(),
        clientKeys.attachmentAll(),
        ["appointments"],
        ["debts"],
        ["deleted-appointments"],
      ]) {
        void qc.invalidateQueries({ queryKey: key });
      }
      haptics.success();
      toast("Объединили");
      void qc.invalidateQueries({ queryKey: duplicateQueryKeyPrefix(tenantId, primary.id) });
      void qc.invalidateQueries({
        queryKey: clientMembersQueryKey(sourceScope?.tenantId ?? null, primary.id),
      });
    } catch (e) {
      haptics.warning();
      toast((e as Error).message || "Не удалось объединить", "error");
    } finally {
      running.current = false;
    }
  };

  return () => {
    closeMenu();
    const blocker = !dup
      ? "Карточка дубля не загрузилась — объединить пока нельзя"
      : !dupAppts.isSuccess
        ? "Записи дубля не загрузились — объединить пока нельзя"
        : mergeBlocker(primary, dup, peopleIdsOf(members, sourceScope?.role === "owner")) ??
          paidVisitsBlocker(dupAppts.data ?? []);
    if (blocker || !dup) {
      haptics.warning();
      toast(blocker ?? "Не удалось объединить", "error");
      return;
    }
    haptics.tap();
    confirmThen(
      "Объединить карточки?",
      {
        // Архива клиентов нет: дубль уходит в «Удалённые клиенты».
        message: `Данные и записи «${dup.full_name || dup.phone}» переедут сюда, а сама карточка уйдёт в «Удалённые клиенты».`,
        confirmLabel: "Объединить",
      },
      () => void merge(dup),
    );
  };
}
