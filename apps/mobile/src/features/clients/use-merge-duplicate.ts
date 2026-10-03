import { useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Client } from "@babun/shared/local/clients";
import { useUpdateAppointment } from "@/features/calendar/mutations";
import { useClientAppointments } from "@/features/clients/appointments";
import { useClientsScopeOrNull } from "@/features/clients/company-scope";
import {
  duplicateQueryKeyPrefix,
  useDuplicateOf,
} from "@/features/clients/DuplicateNotice";
import {
  mergeBlocker,
  mergeClientPatch,
  mergeLocations,
  paidVisitsBlocker,
} from "@/features/clients/merge-clients";
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
import { useSetClientSmsOptOut } from "@/features/sms/sms-account";

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

function freshestClient(qc: QueryClient, id: string): Client | null {
  let best: { at: number; client: Client } | null = null;
  for (const query of qc.getQueryCache().findAll({ queryKey: ["client", id] })) {
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
  const setOptOut = useSetClientSmsOptOut();
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
      //    Ключ карточки длиннее id — ["client", id, компания, вид], — и
      //    точный `getQueryData(["client", id])` не находил ничего: слияние
      //    всегда брало снимок (проверка 03.10). Берём самый свежий из
      //    совпавших по началу ключа.
      const fresh = freshestClient(qc, primary.id) ?? primary;
      const patch = mergeClientPatch(fresh, dupRow);
      // Объект дубля, совпавший с объектом основной, уходит в него — и
      // визиты на нём переезжают на объект основной (аудит 03.10).
      const { remap } = mergeLocations(fresh, dupRow);
      if (Object.keys(patch).length > 0) {
        await updateById.mutateAsync({ id: primary.id, patch });
      }
      // «Клиент просил не писать» переезжает вместе с данными (повторный
      // аудит 03.10): правка клиента его не несёт — у отказа своя функция, —
      // и после слияния основная карточка снова обещала SMS человеку, который
      // просил не писать.
      if (dupRow.sms_opt_out === true && fresh.sms_opt_out !== true) {
        await setOptOut.mutateAsync({
          clientId: primary.id,
          value: true,
          tenantId: sourceScope?.tenantId ?? null,
        });
      }
      // 2. Визиты дубля — ради них слияние и затевается.
      const moving = dupAppts.data ?? [];
      for (const a of moving) {
        const location = a.location_id ? remap.get(a.location_id) : undefined;
        await updateAppt.mutateAsync({
          id: a.id,
          patch: { client_id: primary.id, ...(location ? { location_id: location } : {}) },
        });
      }
      // 3. Дубль — в «Удалённые клиенты» (архива с 03.10 нет): визиты уже
      //    у основной, и без истории он сотрётся через 30 дней; оставшиеся
      //    за ним инвойсы или деньги база не даст стереть сама
      //    (`client_history_never_purges`). Мутация отчитывается числами, а
      //    не исключением: без проверки живой дубль сошёл бы за успех.
      const res = await archive.mutateAsync({ ids: [dupRow.id], trash: true });
      if (res.failed > 0 || res.archived === 0) {
        throw new Error("Карточка объединена, но дубль не удалился");
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
        // Архива клиентов нет с 03.10: дубль уходит в «Удалённые клиенты».
        message: `Данные и визиты «${dup.full_name || dup.phone}» переедут сюда, а сама карточка уйдёт в «Удалённые клиенты».`,
        confirmLabel: "Объединить",
      },
      () => void merge(dup),
    );
  };
}
