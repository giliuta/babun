import { useEffect, useRef, useState } from "react";
import type { Href, useRouter } from "expo-router";
import { usePreventRemove, type NavigationAction } from "@react-navigation/native";
import type { Appointment } from "@babun/shared/local/appointments";
import { chooseOption } from "@/lib/choose";
import { useBeforeUnloadWhileDirty } from "@/lib/use-before-unload";
import { resolveReturnTo } from "@/features/appointments/return-to";
import { draftDirty, type DraftDirtyInput } from "./book-dirty";

/** The part of an inline note field the guard needs. */
interface NoteDraft {
  dirty: boolean;
  discard: () => void;
}

export interface LeaveGuardInput {
  isEdit: boolean;
  hydrated: boolean;
  buildPatch: () => Partial<Appointment>;
  clientNote: NoteDraft;
  objectNote: NoteDraft;
  eventObjectNote: NoteDraft;
  /** What a NEW record counts as typed (everything but the notes). */
  draft: Omit<DraftDirtyInput, "notesDirty">;
  from: string | undefined;
  /** Сохранить сейчас можно (всё обязательное есть, тариф позволяет). */
  saveable: boolean;
  navigation: { dispatch: (action: NavigationAction) => void };
  router: ReturnType<typeof useRouter>;
  /** «Не сохранять» — человек выбросил новую запись: черновик на телефоне
   *  тоже уходит (`book-draft-store.ts`). */
  onDiscardDraft?: () => void;
}

/** «Есть несохранённое», the discard question and the way out of the form. */
export function useLeaveGuard({
  isEdit,
  hydrated,
  buildPatch,
  clientNote,
  objectNote,
  eventObjectNote,
  draft,
  from,
  saveable,
  navigation,
  router,
  onDiscardDraft,
}: LeaveGuardInput) {
  // ПРОГРАММНЫЙ УХОД (сохранение / подтверждённое «Закрыть») СНАЧАЛА СНИМАЕТ
  // ЗАЩИТУ, ПОТОМ УХОДИТ. Повтор перехваченного действия
  // (`navigation.dispatch(data.action)`) у формы, открытой ссылкой без
  // истории, гаснет: `replace("/")` не исполняется. Запись создавалась бы, а
  // форма оставалась — второе «Создать» било бы в дубль, и «Отмена → Закрыть»
  // не закрывала бы ничего.
  const [leaving, setLeaving] = useState(false);

  // A notification/deep link can open /book without a navigation history.
  // In that case router.back() is a dead action; return to the calendar tab.
  //
  // ДОРОГА НАЗАД СИЛЬНЕЕ ИСТОРИИ. Запись из денег открывают через
  // календарь, поэтому стек — «финансы → календарь → запись», и слепой
  // `router.back()` клал человека на календарь. Если пришли с меткой `from`,
  // уходим по ней, а не по истории.
  const leaveBook = () => setLeaving(true);

  // ── «есть несохранённое» ──
  //
  // У СОЗДАНИЯ это «человек что-то ввёл»: сравнивать не с чем, пустой
  // черновик закрывается молча. У ПРАВКИ вопрос другой — «отличается ли
  // форма от того, что лежит в базе», поэтому сравниваем собранный патч со
  // снимком, снятым сразу после гидрации. Снимок берётся эффектом, а не в
  // самой гидрации: сеты состояния к тому моменту ещё не легли.
  const editSignature = isEdit ? JSON.stringify(buildPatch()) : "";
  const editBaselineRef = useRef<string | null>(null);
  useEffect(() => {
    // ФЛАГ СОСТОЯНИЯ, А НЕ REF — ТА ЖЕ ПРИЧИНА, ЧТО У `hydrated` ВЫШЕ.
    // `editHydrated` выставляется синхронно внутри гидрации, поэтому этот
    // эффект отрабатывал в ТОМ ЖЕ коммите и снимал «как было» с ПУСТОЙ формы:
    // сегодняшняя дата, 10:00, ни клиента, ни услуг. Дальше запись ложилась в
    // состояние, подпись расходилась со снимком — и всякая открытая запись
    // считалась изменённой. «Отмена» спрашивала «Закрыть без сохранения?» у
    // того, кто ничего не трогал, то есть диалог врал ровно там, где обязан
    // говорить правду. `hydrated` переключается со следующим рендером — когда
    // значения записи УЖЕ в состоянии.
    if (!isEdit || !hydrated || editBaselineRef.current != null) {
      return;
    }
    editBaselineRef.current = editSignature;
  }, [isEdit, hydrated, editSignature]);

  // Заметки клиента и объекта — тоже «введённое»: диалог «Введённое не
  // сохранится» обязан говорить правду, поэтому их черновики считаются здесь
  // и выбрасываются по явному «Закрыть» (см. `discardNotes`).
  const notesDirty =
    clientNote.dirty || objectNote.dirty || eventObjectNote.dirty;
  const dirty = isEdit
    ? notesDirty ||
      (editBaselineRef.current != null && editSignature !== editBaselineRef.current)
    : draftDirty({ ...draft, notesDirty });
  const discardNotes = () => {
    clientNote.discard();
    objectNote.discard();
    // Заметка объекта у события — тот же черновик: без отказа здесь она
    // уезжала в объект при уходе экрана, хотя человек нажал «Закрыть»
    // (она же считается в `notesDirty`).
    eventObjectNote.discard();
    if (!isEdit) onDiscardDraft?.();
  };
  // ВЫХОД С ИЗМЕНЕНИЯМИ — ВОПРОС «СОХРАНИТЬ?», А НЕ «ЗАКРЫТЬ?». Человек
  // нажал «назад», потому что закончил: чаще всего он хочет сохранить, и
  // заставлять его отменять выход, листать вниз и жать «Сохранить» — лишний
  // круг. «Сохранить» сохраняет и уходит, «Не сохранять» уходит без них,
  // «Отмена» листа оставляет на форме. Сохранение собирается в форме позже
  // этого хука, поэтому приходит ссылкой (`saveRef`).
  const saveRef = useRef<(() => void | Promise<void>) | null>(null);
  // Вопрос называет то, что на экране: у события — «событие», не «запись».
  const event = draft.kind === "event";
  const confirmDiscard = (onDiscard: () => void) => {
    // СОХРАНИТЬ НЕЛЬЗЯ — НЕ ПРЕДЛАГАЕМ. Без услуги или без тарифа
    // «Сохранить» только показывал плашку и оставлял на форме: человек
    // хотел уйти, а вопрос возвращал его назад. Тогда вопрос один — уйти без них.
    if (!saveable) {
      void chooseOption(
        "Закрыть без сохранения?",
        [{ label: "Не сохранять", destructive: true }],
        { message: isEdit ? "Изменения не сохранятся." : "Введённое не сохранится." },
      ).then((index) => {
        if (index !== 0) return;
        discardNotes();
        onDiscard();
      });
      return;
    }
    void chooseOption(
      isEdit ? "Сохранить изменения?" : event ? "Сохранить событие?" : "Сохранить запись?",
      [{ label: "Сохранить" }, { label: "Не сохранять", destructive: true }],
      {
        message: isEdit
          ? event ? "Вы изменили событие." : "Вы изменили запись."
          : event ? "Событие ещё не создано." : "Запись ещё не создана.",
      },
    ).then((index) => {
      if (index === 0) {
        void saveRef.current?.();
        return;
      }
      if (index === 1) {
        discardNotes();
        onDiscard();
      }
    });
  };
  const requestClose = () => {
    if (!dirty) {
      leaveBook();
      return;
    }
    confirmDiscard(leaveBook);
  };

  // Back-свайп и аппаратная «назад» теряли заполненную запись без спроса —
  // теперь перехватываем POP тем же вопросом, что и стрелка «назад».
  useBeforeUnloadWhileDirty(dirty && !leaving);
  usePreventRemove(dirty && !leaving, ({ data }) => {
    confirmDiscard(() => navigation.dispatch(data.action));
  });
  // Уход — после того, как защита снята: навигатор узнаёт о снятии
  // следующим кадром, поэтому переход ждёт его.
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => {
      const returnTo = resolveReturnTo(from);
      if (returnTo) router.replace(returnTo as Href);
      else if (router.canGoBack()) router.back();
      else router.replace("/");
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  return { leaveBook, editBaselineRef, requestClose, saveRef, dirty };
}
