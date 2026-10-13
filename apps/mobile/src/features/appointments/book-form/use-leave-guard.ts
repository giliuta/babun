import { useEffect, useRef, useState } from "react";
import type { Href, useRouter } from "expo-router";
import { usePreventRemove, type NavigationAction } from "@react-navigation/native";
import type { Appointment } from "@babun/shared/local/appointments";
import { confirmThen } from "@/lib/confirm";
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
  // ЗАЩИТУ, ПОТОМ УХОДИТ. Раньше защита пропускала его повтором перехваченного
  // действия (`navigation.dispatch(data.action)`), и у формы, открытой
  // ссылкой без истории, этот повтор гас: `replace("/")` не исполнялся.
  // Запись создавалась, а форма оставалась — второе «Создать» било в дубль,
  // и «Отмена → Закрыть» не закрывала ничего (03.10, на симуляторе).
  const [leaving, setLeaving] = useState(false);

  // A notification/deep link can open /book without a navigation history.
  // In that case router.back() is a dead action; return to the calendar tab.
  //
  // ДОРОГА НАЗАД СИЛЬНЕЕ ИСТОРИИ (2026-09-08). Запись из денег открывают через
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
    // (аудит 2026-10-03; она же считается в `notesDirty`).
    eventObjectNote.discard();
  };
  const confirmDiscard = (onDiscard: () => void) => {
    confirmThen(
      "Закрыть без сохранения?",
      {
        message: "Введённое не сохранится.",
        confirmLabel: "Закрыть",
        destructive: true,
      },
      () => {
        discardNotes();
        onDiscard();
      },
    );
  };
  const requestClose = () => {
    if (!dirty) {
      leaveBook();
      return;
    }
    confirmDiscard(leaveBook);
  };

  // Back-свайп и аппаратная «назад» теряли заполненную запись без спроса —
  // теперь перехватываем POP тем же подтверждением, что и кнопка «Отмена».
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

  return { leaveBook, editBaselineRef, requestClose };
}
