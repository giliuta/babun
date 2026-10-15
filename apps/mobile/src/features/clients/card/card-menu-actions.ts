import { Share } from "react-native";
import type { Client } from "@babun/shared/local/clients";
import { TRASH_DAYS } from "@babun/shared/db/repositories/clients";
import { clientBlockLevel } from "@/features/clients/client-block-access";
import { shareText } from "@/features/clients/client-share";
import { notify } from "@/lib/notify";
import { writeErrorWords } from "@/lib/connection-words";
import { confirmThen } from "@/lib/confirm";
import type { ClientCard } from "./use-client-card";

/** The card's «⋯» menu: what is in it for this viewer and what each item
 *  does. Plain closures over the card, rebuilt per render. */
export function cardMenuActions(card: ClientCard, c: Client) {
  const {
    router,
    isDraft,
    scope,
    caps,
    access,
    stats,
    bookInPlan,
    calendarActionsFor,
    guardedBook,
    setMenuOpen,
    setRemindOpen,
    update,
    trashAsPartner,
    deleteWithUndo,
  } = card;

  // «Напомнить» живёт в меню ⋯ (кнопки на карточке нет) и открывает ТОТ ЖЕ лист, что long-press в списке.
  // Паузу «второй лист ждёт, пока уедет первый» держит сам PickerSheet:
  // своего таймера здесь больше нет, иначе ожидание удваивается.
  const onRemind = () => {
    setMenuOpen(false);
    setRemindOpen(true);
  };

  const onShare = async () => {
    setMenuOpen(false);
    // Всё, что нужно бригаде: имя, телефон, каждый объект со ссылкой и
    // заметкой; реквизиты — по тому же праву, что их блок на странице.
    try {
      await Share.share({ message: shareText(c, { requisites: access.requisites.show }) });
    } catch {
      // user dismissed the share sheet — no-op.
    }
  };

  const onToggleBlacklist = () => {
    setMenuOpen(false);
    update({ blacklisted: !c.blacklisted });
  };


  // Страница объекта читает клиента по id — значит в черновике клиент должен
  // появиться раньше, чем откроется страница. Гейт тот же, что у футера
  // (имя + телефон). ДОБАВЛЕНИЕ этого шага больше не требует: оно живёт в
  // листе снизу и пишет объект в тот же черновик.

  const onBack = () => router.back();

  // МЕНЮ КЛИЕНТА ПАРТНЁРА: «Меню клиента» — всё меню, кроме
  // «Удалить»: Записать, Поделиться, Напомнить, В чёрный список; «Удаление
  // клиента» — «Удалить». Своими дверями сервера.
  const partnerMenu =
    !isDraft && scope?.kind === "member" && clientBlockLevel(c, "clients.menu") === "write";
  const partnerDelete =
    !isDraft && scope?.kind === "member" && clientBlockLevel(c, "clients.delete") === "write";

  // «Записать» — первым в «⋯». Нет права записи в команде клиента — нет и
  // пункта.
  const bookTeam = c.team_id ?? stats?.lastTeamId ?? null;
  const onBookFromMenu =
    !isDraft &&
    caps.book &&
    (scope?.kind === "member" ? partnerMenu : bookInPlan) &&
    calendarActionsFor(bookTeam).create
      ? () => {
          setMenuOpen(false);
          guardedBook(c, {
            locationId:
              c.locations?.find((l) => l.isPrimary)?.id ?? c.locations?.[0]?.id ?? null,
            // Та же команда, по которой проверено право записи (иначе
            // проверка шла бы по команде клиента, а календарь открывался бы в
            // команде последнего визита — без права там).
            teamId: bookTeam,
          });
        }
      : undefined;

  // УДАЛИТЬ — ОДНО ДЕЙСТВИЕ (архива нет). Клиент уходит в «Удалённые клиенты». Без истории он сотрётся через 30
  // дней; за клиентом с визитами стоит финансовая история, и база снимает
  // ему срок сама (`client_history_never_purges`) — он лежит там, пока его не
  // вернут. Поэтому слова подтверждения зависят от истории.
  const onDelete = () => {
    setMenuOpen(false);
    // Партнёр с «Удаление клиента: Может» — своей дверью, вернуть может
    // владелец.
    if (!caps.manage) {
      confirmThen(
        "Удалить клиента?",
        {
          message: `${c.full_name || "Клиент"} исчезнет из клиентов команды. Вернуть его может владелец.`,
          confirmLabel: "Удалить",
          destructive: true,
        },
        async () => {
          try {
            await trashAsPartner.mutateAsync(c.id);
            router.back();
          } catch (e) {
            // Обрыв — словами, а не «TypeError: Network request failed».
            const words = writeErrorWords(e, { failed: "Не удалось удалить", notDone: "Клиент не удалён" });
            notify(words.title, words.subtitle);
          }
        },
      );
      return;
    }
    // ЛЮБАЯ запись — уже история, даже будущая.
    const hasHistory =
      (stats?.visits ?? 0) > 0 ||
      (stats?.totalSpent ?? 0) > 0 ||
      (stats?.unclosedVisits ?? 0) > 0 ||
      stats?.nextApt != null;
    confirmThen(
      "Удалить клиента?",
      {
        message: hasHistory
          ? `${c.full_name || "Клиент"} уйдёт в «Удалённые клиенты». Записи и деньги останутся в отчётах; вернуть его можно там же, в шестерёнке.`
          : `${c.full_name || "Клиент"} уйдёт в «Удалённые клиенты» и будет стёрт через ${TRASH_DAYS} дней. До этого его можно вернуть — там же, в шестерёнке.`,
        confirmLabel: "Удалить",
        destructive: true,
      },
      async () => {
        try {
          const res = await deleteWithUndo([c]);
          if (res.archived > 0) router.back();
        } catch (e) {
          const words = writeErrorWords(e, { failed: "Не удалось удалить", notDone: "Клиент не удалён" });
          notify(words.title, words.subtitle);
        }
      },
    );
  };

  return {
    onRemind,
    onShare,
    onToggleBlacklist,
    onBack,
    partnerMenu,
    partnerDelete,
    onBookFromMenu,
    onDelete,
  };
}

export type CardMenu = ReturnType<typeof cardMenuActions>;
