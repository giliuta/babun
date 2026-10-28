import { useEffect, useRef, useState } from "react";
import type { useRouter } from "expo-router";
import type { useToast } from "@/components/ui/Toast";
import type { Appointment } from "@babun/shared/local/appointments";
import {
  clearBookDraft,
  clearEditDraft,
  readBookDraft,
  readEditDraft,
  writeBookDraft,
  writeEditDraft,
  type BookDraftSnapshot,
} from "./book-draft-store";

/** Черновик новой записи, поднятый с телефона при открытии формы, и способ
 *  его забыть. Читается один раз — первым рендером, до умолчаний формы.
 *  У правки (`editId`) снимок поднимается позже — `useRestoreEditDraft`. */
export function useRestoredBookDraft(
  tenantId: string | null,
  editId: string | null,
  kind: "work" | "event",
  /** Форма открыта копией (`copyOf`): её поля — из оригинала, а не из
   *  прошлого черновика. */
  copying = false,
) {
  const [restored] = useState(() =>
    editId || copying ? null : readBookDraft(tenantId, kind),
  );
  // Запись создана или черновик выброшен рукой — больше не пишем, даже если
  // форма ещё дорисовывает последний кадр перед уходом.
  const stoppedRef = useRef(false);
  const wroteRef = useRef(false);
  const forget = () => {
    stoppedRef.current = true;
    if (editId) clearEditDraft(tenantId, editId);
    else clearBookDraft(tenantId);
  };
  return { restored, forget, stoppedRef, wroteRef };
}

type Memory = ReturnType<typeof useRestoredBookDraft>;

/** Каждое изменение новой записи — на телефон; восстановленный черновик —
 *  плашкой с «Удалить черновик». */
export function usePersistBookDraft({
  memory,
  tenantId,
  isEdit,
  edit,
  dirty,
  snapshot,
  toast,
  router,
}: {
  memory: Memory;
  tenantId: string | null;
  isEdit: boolean;
  /** Правка: какая запись и в каком виде открыта (`useRestoreEditDraft`);
   *  `null`, пока она не легла в форму. */
  edit: { id: string; base: string } | null;
  /** «Человек что-то ввёл» — тот же ответ, что у вопроса при выходе. */
  dirty: boolean;
  snapshot: Omit<BookDraftSnapshot, "v" | "savedAt">;
  toast: ReturnType<typeof useToast>;
  router: ReturnType<typeof useRouter>;
}) {
  const signature = JSON.stringify(snapshot);
  useEffect(() => {
    if (memory.stoppedRef.current) return;
    if (isEdit) {
      if (!edit) return;
      if (dirty) {
        writeEditDraft(tenantId, { v: 1, savedAt: Date.now(), id: edit.id, base: edit.base, snap: snapshot });
        memory.wroteRef.current = true;
      } else if (memory.wroteRef.current) {
        // Вернул всё как было — снимка больше нет. Только после своей
        // записи: в коммите подъёма форма ещё «не изменена», и стирание
        // здесь съедало бы только что поднятый снимок.
        clearEditDraft(tenantId, edit.id);
      }
      return;
    }
    if (dirty) {
      writeBookDraft(tenantId, { v: 1, savedAt: Date.now(), ...snapshot });
      memory.wroteRef.current = true;
      return;
    }
    // Стёрли всё набранное руками — черновика больше нет. Только свой:
    // открытое «Создать событие» не трогает лежащий черновик записи.
    if (memory.restored || memory.wroteRef.current) clearBookDraft(tenantId);
    // `snapshot` целиком сказан подписью.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, edit, dirty, signature, tenantId]);

  useEffect(() => {
    if (!memory.restored) return;
    toast("Черновик восстановлен", "info", {
      label: "Удалить черновик",
      onPress: () => {
        memory.forget();
        // Новая метка — новая форма (ключ `BookForm`): с тем днём и
        // клиентом, с какими её открыли, без поднятого.
        router.setParams({ fresh: String(Date.now()) });
      },
    });
    // Плашка — один раз на открытие формы.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** ПРАВКА ЗАПИСИ ПОДНИМАЕТСЯ С ТЕЛЕФОНА (I-04) — один раз, когда запись
 *  легла в форму и снят снимок «как было» (хук зовётся ПОСЛЕ `useLeaveGuard`:
 *  эффекты одного компонента идут в порядке объявления). Возвращает, какая
 *  запись открыта и в каком виде, — под этим её правка и пишется. */
export function useRestoreEditDraft({
  memory,
  tenantId,
  editing,
  hydrated,
  apply,
  toast,
  router,
}: {
  memory: Memory;
  tenantId: string | null;
  editing: Appointment | null;
  hydrated: boolean;
  apply: (snap: Omit<BookDraftSnapshot, "v" | "savedAt">) => void;
  toast: ReturnType<typeof useToast>;
  router: ReturnType<typeof useRouter>;
}): { id: string; base: string } | null {
  const [opened, setOpened] = useState<{ id: string; base: string } | null>(null);
  useEffect(() => {
    if (opened || !hydrated || !editing) return;
    // Вид записи при открытии, а не при каждом обновлении кеша: снимок
    // сверяется именно с ним.
    const base = { id: editing.id, base: editing.updated_at };
    setOpened(base);
    const saved = readEditDraft(tenantId, base.id, base.base);
    if (!saved) return;
    apply(saved.snap);
    toast("Черновик восстановлен", "info", {
      label: "Удалить черновик",
      onPress: () => {
        memory.forget();
        // Новая метка — новая форма: запись, как она лежит в базе.
        router.setParams({ fresh: String(Date.now()) });
      },
    });
    // Один раз на открытие формы.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, editing]);
  return opened;
}
