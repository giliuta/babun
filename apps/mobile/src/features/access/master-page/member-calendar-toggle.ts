import type { useToast } from "@/components/ui/Toast";
import { chooseOption } from "@/lib/choose";
import { notify } from "@/lib/notify";
import type { AccessBlock, AccessChange } from "@/session/access-map";
import { copyCalendarLevels, starterCalendarChanges, type MasterDraft } from "./master-draft";
import { memberRefusalText } from "./member-rights-writer";
import type { PartnerManager } from "@/session/partner-manager";

export interface CalendarTogglerDeps {
  manager: PartnerManager;
  teamsAllowed: ReadonlySet<string> | null;
  draft: MasterDraft;
  blocks: readonly AccessBlock[];
  teamNameOf: (id: string) => string | null;
  setCalendars: { mutateAsync: (teamIds: readonly string[]) => Promise<unknown> };
  setAccess: { mutateAsync: (changes: readonly AccessChange[]) => Promise<unknown> };
  toast: ReturnType<typeof useToast>;
  setActiveTeam: (id: string) => void;
  setCalendarsOpen: (open: boolean) => void;
  /** Closes the calendars sheet and resolves once it has left the screen. */
  closeCalendarsSheet: () => Promise<void>;
}

/** Прикрепить или открепить календарь. Открепление спрашивает словами: в
 *  этом календаре человек разом теряет и записи, и деньги, и права — их
 *  уровни там больше не считаются. */
export function calendarToggler({
  manager,
  teamsAllowed,
  draft,
  blocks,
  teamNameOf,
  setCalendars,
  setAccess,
  toast,
  setActiveTeam,
  setCalendarsOpen,
  closeCalendarsSheet,
}: CalendarTogglerDeps): (id: string) => Promise<void> {
  return async (id: string) => {
    if (manager.readOnly) {
      notify(manager.readOnly);
      return;
    }
    if (teamsAllowed && !teamsAllowed.has(id)) {
      notify("Эту команду назначает владелец", "Добавлять и снимать можно только команды, где работаете вы.");
      return;
    }
    const current = draft.teamIds;
    const attached = current.includes(id);
    const next = attached ? current.filter((teamId) => teamId !== id) : [...current, id];
    // ЖДЁМ ОТВЕТ ПРЯМО (`mutateAsync`), а не обратным вызовом `mutate`:
    // ответ перерисовывает карточку, и обратный вызов прежнего нажатия
    // react-query молча не зовёт — вопрос про права не появлялся бы.
    const save = async (): Promise<boolean> => {
      try {
        await setCalendars.mutateAsync(next);
        return true;
      } catch (error) {
        toast(memberRefusalText(error), "error");
        return false;
      }
    };
    if (!attached) {
      // НОВЫЙ КАЛЕНДАРЬ — СПРОСИТЬ, КАК В КАКОМ (одного и того же мастера
      // добавляют в каждый календарь). В новом
      // календаре у человека всё «Не видит»; чаще всего нужны те же права,
      // что уже стоят в его первом календаре, — одним тапом, без десяти строк.
      const source = current.find((teamId) => teamNameOf(teamId));
      if (!(await save())) return;
      // Новая команда сразу выбрана в ленте: её права ставятся прямо здесь.
      setActiveTeam(id);
      // Стартовые права нового календаря: без них человек
      // входил в календарь и не видел в нём даже своей работы.
      const applyStarter = async () => {
        const changes = starterCalendarChanges(blocks, id);
        if (changes.length === 0) return;
        try {
          await setAccess.mutateAsync(changes);
        } catch (error) {
          toast(memberRefusalText(error), "error");
        }
      };
      // Шаблонов доступа нет: вопрос — «как в …» или сам.
      if (!source) {
        await applyStarter();
        return;
      }
      // ВОПРОС — КОГДА ЛИСТ КАЛЕНДАРЕЙ УЖЕ СНЯТ. Два нижних листа iOS подряд
      // не показывает: вопрос, поднятый по таймеру, пока лист ещё уезжал,
      // молча терялся. Ждём `onExited` самого листа.
      await closeCalendarsSheet();
      const sourceName = source ? (teamNameOf(source) ?? "первом календаре") : "";
      const targetName = teamNameOf(id) ?? "новом календаре";
      const answer = await chooseOption(`Права в «${targetName}»`, [
        { label: `Как в «${sourceName}»` },
        { label: "Выставлю сам" },
      ]);
      if (answer === 0) {
        try {
          await setAccess.mutateAsync(copyCalendarLevels(blocks, draft, source, id));
          toast(`Права как в «${sourceName}»`);
        } catch (error) {
          toast(memberRefusalText(error), "error");
        }
      } else {
        // «Выставлю сам» и закрытый вопрос — со стартовых прав.
        await applyStarter();
      }
      return;
    }
    // УБИРАЕМ СРАЗУ, С «ОТМЕНИТЬ» (свайпом, без вопроса). Права в этом календаре уходят вместе
    // с ним (каскад на сервере), поэтому «Отменить» возвращает и календарь, и
    // его положения — из снимка до ухода.
    const teamName = teamNameOf(id) ?? "календаря";
    const restoreLevels = copyCalendarLevels(blocks, draft, id, id);
    setCalendarsOpen(false);
    if (!(await save())) return;
    toast(`Убран из «${teamName}»`, "success", {
      label: "Отменить",
      onPress: () =>
        void setCalendars
          .mutateAsync(current)
          .then(() => setAccess.mutateAsync(restoreLevels))
          .catch((error) => toast(memberRefusalText(error), "error")),
    });
  };
}
