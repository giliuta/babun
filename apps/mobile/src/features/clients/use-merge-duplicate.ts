import { useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Client } from "@babun/shared/local/clients";
import { useUpdateAppointment } from "@/features/calendar/mutations";
import { useClientAppointments } from "@/features/clients/appointments";
import { useClientsScopeOrNull } from "@/features/clients/company-scope";
import {
  duplicateQueryKeyPrefix,
  useDuplicateOf,
} from "@/features/clients/DuplicateNotice";
import { mergeBlocker, mergeClientPatch } from "@/features/clients/merge-clients";
import {
  useArchiveClients,
  useClient,
  useClientsSourceScope,
  useUpdateClientById,
} from "@/features/clients/queries";
import { useClientMembers } from "@/features/clients/use-client-links";
import { clientMembersQueryKey, parseLinkKey } from "@/features/clients/use-link-writer";
import { useToast } from "@/components/ui/Toast";
import { confirmThen } from "@/lib/confirm";
import { haptics } from "@/lib/haptics";
import { useTenantId } from "@/lib/tenant";

// «ОБЪЕДИНИТЬ С ДУБЛЕМ» — ПУНКТ «⋯» КАРТОЧКИ.
//
// Кнопка жила в плашке дубля, но внутри содержимого кнопок нет (владелец
// 2026-09-15), и слияние переехало в меню к остальным необратимым. Дубль —
// тот же, что называет плашка (`useDuplicateOf`, один ключ, один запрос).
//
// ПОРЯДОК НЕ МЕНЯТЬ: патч основной → записи дубля → архив дубля. Патч не лёг —
// записи не едут (иначе они уедут к карточке без данных дубля); архив не
// прошёл — это ошибка словами: живой дубль вернул бы плашку, а второе
// слияние сложило бы всё ещё раз.

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
  // Записи переносятся клиентом АКТИВНОЙ компании (`useUpdateAppointment`):
  // своя база, открытая не в календаре, ушла бы под чужой заголовок.
  const eligible =
    !!client && !isDraft && !client.deleted_at && canManage && (scope?.isActive ?? true);
  const dupId = useDuplicateOf(eligible ? client : null);
  const dup = useClient(dupId ?? "").data ?? null;
  const members = useClientMembers(dupId);
  const dupAppts = useClientAppointments(dupId ?? "");
  const updateById = useUpdateClientById();
  const updateAppt = useUpdateAppointment();
  const archive = useArchiveClients();
  const running = useRef(false);

  if (!eligible || !client || !dupId) return undefined;
  const primary = client;

  const merge = async (dupRow: Client) => {
    // Засов рефом, а не состоянием: два тапа в одном кадре оба видели бы
    // «свободно» и слили бы дважды — заметки удвоились бы.
    if (running.current) return;
    running.current = true;
    try {
      // 1. Дополняем основную. Не записалось — дальше не идём.
      //    Карточку берём СВЕЖУЮ из кэша: патч перезаписывает массивы
      //    (номера, объекты, заметки, связи) целиком, и снимок с момента
      //    открытия страницы затёр бы номер, добавленный секунду назад
      //    (аудит 22.09).
      const fresh =
        qc.getQueryData<Client>(["client", primary.id]) ?? primary;
      const patch = mergeClientPatch(fresh, dupRow);
      if (Object.keys(patch).length > 0) {
        await updateById.mutateAsync({ id: primary.id, patch });
      }
      // 2. Визиты дубля — ради них слияние и затевается.
      const moving = dupAppts.data ?? [];
      for (const a of moving) {
        await updateAppt.mutateAsync({ id: a.id, patch: { client_id: primary.id } });
      }
      // 3. Дубль — в архив, не в удаление. Архивация отчитывается числами, а
      //    не исключением: без проверки живой дубль сошёл бы за успех.
      const res = await archive.mutateAsync({ ids: [dupRow.id] });
      if (res.failed > 0 || res.archived === 0) {
        throw new Error("Карточка объединена, но дубль не ушёл в архив");
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
        ? "Визиты дубля не загрузились — объединить пока нельзя"
        : mergeBlocker(primary, dup, peopleIdsOf(members, sourceScope?.role === "owner"));
    if (blocker || !dup) {
      haptics.warning();
      toast(blocker ?? "Не удалось объединить", "error");
      return;
    }
    haptics.tap();
    confirmThen(
      "Объединить карточки?",
      {
        message: `Данные и визиты «${dup.full_name || dup.phone}» переедут сюда, а сама карточка уйдёт в архив.`,
        confirmLabel: "Объединить",
      },
      () => void merge(dup),
    );
  };
}
