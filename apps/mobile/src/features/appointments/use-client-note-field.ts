import { useMemo } from "react";
import type { Client, ClientNote } from "@babun/shared/local/clients";
import { randomUuid } from "@babun/shared/sync/uuid";
import { applyNoteEdit } from "@/features/appointments/client-note-journal";
import { useInlineNote } from "@/features/appointments/use-inline-note";
import { useUpdateClientById } from "@/features/clients/queries";
import { useJsonArrayWriter } from "@/features/clients/use-json-writer";

// ЗАМЕТКА КЛИЕНТА ПОЛЕМ ПОД БЛОКОМ «КЛИЕНТ» — ОДИН КОД НА ВСЕ ДОКУМЕНТЫ.
//
// Жила внутри формы записи (`app/book/index.tsx`); инвойс попросил «точно
// такой же блок клиента, как в записи» (владелец 2026-09-22), и вторая копия
// этой логики назавтра разошлась бы с первой. Вынесено как есть.
//
// Владелец 2026-09-04: «не надо тапать „добавить заметку“ — мини-блок, куда
// можно вписывать сразу». Заметка клиента — ПОСЛЕДНЯЯ ЗАПИСЬ ЖУРНАЛА: поле
// правит её на месте, пустому журналу заводит первую, стёрли поле — запись
// уходит. Импортированная заметка (`comment` из CSV) при первой правке
// переезжает в журнал ОДНИМ патчем вместе с журналом: два патча подряд в
// офлайн-кэше затирали друг другу колонку (ревью 2026-09-04).

const EMPTY_NOTES: ClientNote[] = [];

export function useClientNoteField(client: Client | null) {
  const updateClient = useUpdateClientById();
  const clientId = client?.id ?? null;

  // Последняя заметка — по дате: порядок массива не закон. Импортированный
  // `comment` — та же заметка, пока журнала ещё нет (как на карточке).
  const entry = useMemo(() => {
    if (!client) return null;
    const newest = [...(client.notes ?? [])].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    )[0];
    if (newest) return { id: newest.id, text: newest.text };
    const imported = (client.comment ?? "").trim();
    return imported ? { id: null, text: imported } : null;
  }, [client]);

  const migrateImportedComment =
    !!client && (client.notes ?? []).length === 0 && (client.comment ?? "").trim() !== "";

  const notesWriter = useJsonArrayWriter<ClientNote>(
    client?.notes ?? EMPTY_NOTES,
    async (next) => {
      if (!clientId) return false;
      try {
        await updateClient.mutateAsync({
          id: clientId,
          patch: migrateImportedComment ? { notes: next, comment: "" } : { notes: next },
        });
        return true;
      } catch {
        // useUpdateClientById показывает причину; правку не считаем записанной.
        return false;
      }
    },
    clientId,
  );

  // Поле привязано к КОНКРЕТНОЙ записи журнала (ключ — её id): стёр — снялась
  // именно она; набрал заново после стирания — родилась новая. `null` —
  // записи ещё нет.
  const write = (next: string, boundId: string | null) => {
    if (!client) return;
    let createdId: string | null = null;
    void notesWriter.apply((all) => {
      const edited = applyNoteEdit(all, next, boundId, () => ({
        id: randomUuid(),
        created_at: new Date().toISOString(),
      }));
      createdId = edited.createdId;
      return edited.notes;
    });
    return createdId ?? undefined;
  };

  return useInlineNote<string | null>(entry?.text ?? "", entry?.id ?? null, write, clientId);
}
