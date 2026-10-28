import { useState } from "react";
import { Share } from "react-native";
import type { Client } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import { TRASH_DAYS } from "@babun/shared/db/repositories/clients";
import { confirmThen } from "@/lib/confirm";
import { upcomingRecordsNote } from "@/features/clients/delete-words";
import { useToast } from "@/components/ui/Toast";
import { notify } from "@/lib/notify";
import { writeErrorWords } from "@/lib/connection-words";
import { useLastNonNull } from "@/lib/use-last-non-null";
import { useTrashClientAsPartner, type useUpdateClientById } from "@/features/clients/queries";
import type { useDeleteWithUndo } from "@/features/clients/delete-undo";
import { shareText, type ShareTextOptions } from "@/features/clients/client-share";
import {
  capabilitiesOf,
  type ClientsCapabilities,
  type ClientsScope,
} from "@/session/clients-company";
import { clientRowActions } from "@/features/clients/client-row-actions";
import { useGuardedBookingNav } from "@/features/clients/card-booking";
import { ALL_TEAMS } from "@/features/clients/team-scope";
import { useCalendarActionsReader } from "@/features/appointments/useRecordRights";
import { usePlanAllows } from "@/session/tenant";

/** Слова неудачи удаления одного клиента (`writeErrorWords`). */
const CLIENT_NOT_DELETED = { failed: "Не удалось удалить", notDone: "Клиент не удалён" };

/** What a row can do — swipes, the long-press sheet, «Записать», remind,
 *  blacklist, share and delete — each in the company of that row. */
export function useListRowActions({
  scope,
  caps,
  guestOf,
  teamChoice,
  allStatsMap,
  deleteWithUndo,
  updateById,
}: {
  scope: ClientsScope | null;
  caps: ClientsCapabilities;
  guestOf: Map<string, ClientsScope>;
  teamChoice: string;
  allStatsMap: Map<string, ClientStats>;
  deleteWithUndo: ReturnType<typeof useDeleteWithUndo>;
  updateById: ReturnType<typeof useUpdateClientById>;
}) {
  // ── Long-press меню клиента (web v313 parity) — нижний лист
  // ClientActionsSheet; здесь только состояние и обработчики.
  const toast = useToast();
  const [menuClient, setMenuClient] = useState<Client | null>(null);

  // Напоминание — ТОТ ЖЕ лист, что на карточке: одно действие не может
  // выглядеть по-разному в двух местах (раньше здесь был системный Alert).
  const [remindClient, setRemindClient] = useState<Client | null>(null);
  const openRemindMenu = (c: Client) => setRemindClient(c);
  // Своя база без тарифа только смотрит: «Напомнить» и «В
  // чёрный список» сервер отказал бы — карточка их и так гасит. Что ещё
  // можно со строкой — `rowActionsOf` ниже (`client-row-actions.ts`).
  const clientsInPlan = usePlanAllows("clients");
  // «Записать» — только с правом «Новые записи» в команде записи.
  const calendarActionsFor = useCalendarActionsReader();
  const trashAsPartner = useTrashClientAsPartner();
  // Удаление партнёра — своей дверью сервера; вернуть может владелец.
  const confirmPartnerDelete = (c: Client) => {
    confirmThen(
      "Удалить клиента?",
      {
        message: `${c.full_name || "Клиент"} исчезнет из клиентов команды. Вернуть его может владелец.`,
        confirmLabel: "Удалить",
        destructive: true,
      },
      async () => {
        try {
          // Строка работодателя удаляется в ЕГО компании (`source`), а не в
          // своей: там такого клиента нет.
          await trashAsPartner.mutateAsync({ id: c.id, source: guestOf.get(c.id) });
        } catch (e) {
          // Обрыв — словами, а не «TypeError: Network request failed».
          const words = writeErrorWords(e, CLIENT_NOT_DELETED);
          notify(words.title, words.subtitle);
        }
      },
    );
  };

  // ЗАПИСАТЬ ПРЯМО ИЗ СПИСКА (свайп вправо и лист действий). Строка уже знает
  // и основной объект, и последнюю команду — те же два поля, что подставляет
  // карточка, поэтому лишний заход в карточку ради «Записать» больше не
  // нужен. Чёрный список спрашивает через тот же общий гейт.
  const guardedBook = useGuardedBookingNav();
  // Команда записи: под чипом — выбранная (её список и открыт); без чипа —
  // команда клиента, у клиента без неё — команда последнего визита.
  const bookTeamOf = (c: Client) =>
    teamChoice !== ALL_TEAMS
      ? teamChoice
      : (c.team_id ?? allStatsMap.get(c.id)?.lastTeamId ?? null);
  const bookFor = (c: Client) => {
    const primary =
      (c.locations ?? []).find((l) => l.isPrimary)?.id ??
      (c.locations ?? [])[0]?.id ??
      null;
    guardedBook(c, {
      locationId: primary,
      teamId: bookTeamOf(c),
    });
  };

  // ЖЕСТЫ И МЕНЮ СТРОКИ — ПО КОМПАНИИ СТРОКИ (`client-row-actions.ts`). Своя строка — права своей базы, как было;
  // строка работодателя — права его источника: «Записать» у неё есть, только
  // когда открыт ЕГО календарь (запись делается в открытом), а «Напомнить»,
  // «В чёрный список» и «Удалить» пишутся в его компанию (`source`).
  const ownRights = {
    edit: clientsInPlan && caps.edit,
    manage: caps.manage,
    export: caps.export,
    book: caps.book,
  };
  const rowActionsOf = (c: Client, selectingNow: boolean, teamCreate?: boolean) => {
    const guest = guestOf.get(c.id);
    return clientRowActions({
      client: c,
      guest: !!guest,
      selecting: selectingNow,
      rights: guest ? capabilitiesOf(guest) : ownRights,
      teamCreate,
    });
  };
  // Лист — про клиента, а не про режим: пункты не меняются, пока он уезжает
  // после «Выбрать несколько».
  const menuActions = menuClient
    ? rowActionsOf(menuClient, false, calendarActionsFor(bookTeamOf(menuClient)).create)
    : null;
  // КОМПАНИЯ ЛИСТА — КОМПАНИЯ СТРОКИ: его хуки (реквизиты для
  // «Поделиться») читают её. Последняя держится, пока лист уезжает, — как и
  // сам клиент листа.
  const menuScope =
    useLastNonNull(menuClient ? (guestOf.get(menuClient.id) ?? scope) : null) ?? scope;

  // УДАЛИТЬ — ОДНО ДЕЙСТВИЕ (архива нет). Клиент уходит в «Удалённые клиенты». Без истории он сотрётся
  // через 30 дней; клиенту с визитами и деньгами база срок снимает сама
  // (`client_history_never_purges`) — его история в отчётах. Слова
  // подтверждения поэтому зависят от истории.
  const confirmDeleteOne = (c: Client) => {
    if (c.blocks) {
      confirmPartnerDelete(c);
      return;
    }
    const stats = allStatsMap.get(c.id);
    // ЛЮБАЯ запись — уже история, даже будущая.
    const hasHistory =
      (stats?.visits ?? 0) > 0 ||
      (stats?.totalSpent ?? 0) > 0 ||
      (stats?.pastOpenRecords ?? 0) > 0 ||
      stats?.nextApt != null;
    confirmThen(
      "Удалить клиента?",
      {
        message:
          (hasHistory
            ? `${c.full_name || "Клиент"} уйдёт в «Удалённые клиенты». Записи и деньги останутся в отчётах; вернуть его можно в шестерёнке.`
            : `${c.full_name || "Клиент"} уйдёт в «Удалённые клиенты» и будет стёрт через ${TRASH_DAYS} дней. До этого его можно вернуть — в шестерёнке.`) +
          upcomingRecordsNote(stats?.upcomingRecords ?? 0),
        confirmLabel: "Удалить",
        destructive: true,
      },
      async () => {
        try {
          await deleteWithUndo([c]);
        } catch (e) {
          const words = writeErrorWords(e, CLIENT_NOT_DELETED);
          notify(words.title, words.subtitle);
        }
      },
    );
  };

  // Правки по строке — в компанию строки: у работодателя — его клиентом
  // (`source`), у своей — источником экрана, как было.
  // Чёрный список отменяется тем же тапом из тоста: пометка вслепую из
  // меню строки иначе замечалась только по значку в списке.
  const onToggleBlacklist = (c: Client) => {
    const next = !c.blacklisted;
    const source = guestOf.get(c.id);
    // `mutateAsync`, а не `mutate(..., { onSuccess })`: колбэки второго
    // аргумента TanStack зовёт только у ПОСЛЕДНЕГО вызова, и два быстрых
    // тапа по разным строкам оставляли первую без тоста и без «Отменить».
    // Отказ уже показала сама мутация (`onError`), поэтому здесь ловим его
    // молча — только чтобы не было необработанного отклонения.
    updateById
      .mutateAsync({ id: c.id, patch: { blacklisted: next }, source })
      .then(() =>
        toast(next ? "Клиент в чёрном списке" : "Клиент убран из чёрного списка", "info", {
          label: "Отменить",
          onPress: () =>
            updateById.mutate({ id: c.id, patch: { blacklisted: !next }, source }),
        }),
      )
      .catch(() => {});
  };

  // «Поделиться» — тот же текст, что из «⋯» карточки (`shareText`). Реквизиты
  // в нём — только когда их видно (иначе из списка они уходили бы всегда,
  // даже при скрытом блоке «Реквизиты»). Видно ли — решает лист меню в
  // компании строки (`menuScope` ниже): у клиента работодателя выключатели
  // его компании и команды, а не своей.
  const onShareClient = async (c: Client, opts: ShareTextOptions) => {
    try {
      await Share.share({ message: shareText(c, opts) });
    } catch {
      // user dismissed the share sheet — no-op.
    }
  };

  return {
    menuClient,
    setMenuClient,
    remindClient,
    setRemindClient,
    openRemindMenu,
    clientsInPlan,
    bookFor,
    rowActionsOf,
    menuActions,
    menuScope,
    confirmDeleteOne,
    onToggleBlacklist,
    onShareClient,
  };
}
