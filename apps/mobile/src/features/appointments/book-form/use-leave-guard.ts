import { useEffect, useRef, useState } from "react";
import type { Href, useRouter } from "expo-router";
import { usePreventRemove, type NavigationAction } from "@react-navigation/native";
import type { Appointment } from "@babun/shared/local/appointments";
import { chooseOption } from "@/lib/choose";
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
  navigation: { dispatch: (action: NavigationAction) => void };
  router: ReturnType<typeof useRouter>;
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
  navigation,
  router,
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
  };
  // ВЫХОД С ИЗМЕНЕНИЯМИ — ВОПРОС «СОХРАНИТЬ?», А НЕ «ЗАКРЫТЬ?». Человек
  // нажал «назад», потому что закончил: чаще всего он хочет сохранить, и
  // заставлять его отменять выход, листать вниз и жать «Сохранить» — лишний
  // круг. «Сохранить» сохраняет и уходит, «Не сохранять» уходит без них,
  // «Отмена» листа оставляет на форме. Сохранение собирается в форме позже
  // этого хука, поэтому приходит ссылкой (`saveRef`).
  const saveRef = useRef<(() => void | Promise<void>) | null>(null);
  const confirmDiscard = (onDiscard: () => void) => {
    void chooseOption(
      isEdit ? "Сохранить изменения?" : "Сохранить запись?",
      [{ label: "Сохранить" }, { label: "Не сохранять", destructive: true }],
      { message: isEdit ? "Вы изменили запись." : "Запись ещё не создана." },
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

  return { leaveBook, editBaselineRef, requestClose, saveRef };
}
