import { useEffect, useRef, useState } from "react";
import type { useRouter } from "expo-router";
import type { useToast } from "@/components/ui/Toast";
import {
  clearBookDraft,
  readBookDraft,
  writeBookDraft,
  type BookDraftSnapshot,
} from "./book-draft-store";

/** Черновик новой записи, поднятый с телефона при открытии формы, и способ
 *  его забыть. Читается один раз — первым рендером, до умолчаний формы. */
export function useRestoredBookDraft(
  tenantId: string | null,
  isEdit: boolean,
  kind: "work" | "event",
) {
  const [restored] = useState(() => (isEdit ? null : readBookDraft(tenantId, kind)));
  // Запись создана или черновик выброшен рукой — больше не пишем, даже если
  // форма ещё дорисовывает последний кадр перед уходом.
  const stoppedRef = useRef(false);
  const wroteRef = useRef(false);
  const forget = () => {
    stoppedRef.current = true;
    clearBookDraft(tenantId);
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
  dirty,
  snapshot,
  toast,
  router,
}: {
  memory: Memory;
  tenantId: string | null;
  isEdit: boolean;
  /** «Человек что-то ввёл» — тот же ответ, что у вопроса при выходе. */
  dirty: boolean;
  snapshot: Omit<BookDraftSnapshot, "v" | "savedAt">;
  toast: ReturnType<typeof useToast>;
  router: ReturnType<typeof useRouter>;
}) {
  const signature = JSON.stringify(snapshot);
  useEffect(() => {
    if (isEdit || memory.stoppedRef.current) return;
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
  }, [isEdit, dirty, signature, tenantId]);

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
