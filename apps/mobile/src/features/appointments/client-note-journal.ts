import type { ClientNote } from "@babun/shared/local/clients";

// ПРАВКА ЖУРНАЛА ЗАМЕТОК ОДНИМ ПОЛЕМ (форма записи, «Заметка клиента»).
//
// Поле привязано к КОНКРЕТНОЙ записи журнала по id, а не к «последней»:
// стёр — снялась именно она; набрал заново после стирания — родилась новая,
// а не переписалась соседняя; повторный вызов с тем же намерением ничего не
// ломает (ревью 2026-09-04: «стирание дважды снимало две записи»).
export function applyNoteEdit(
  all: readonly ClientNote[],
  next: string,
  boundId: string | null,
  fresh: () => Pick<ClientNote, "id" | "created_at">,
): { notes: ClientNote[]; createdId: string | null } {
  const exists = boundId != null && all.some((n) => n.id === boundId);
  if (!next) {
    return {
      notes: exists ? all.filter((n) => n.id !== boundId) : [...all],
      createdId: null,
    };
  }
  if (exists) {
    return {
      notes: all.map((n) => (n.id === boundId ? { ...n, text: next } : n)),
      createdId: null,
    };
  }
  const created = { ...fresh(), text: next };
  return { notes: [created, ...all], createdId: created.id };
}
