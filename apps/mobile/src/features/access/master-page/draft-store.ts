import { useSyncExternalStore } from "react";

import { emptyMasterDraft, type MasterDraft } from "./master-draft";

// ЧЕРНОВИК НОВОГО МАСТЕРА — ОДИН НА ПРИЛОЖЕНИЕ (владелец 15.09: права мастера —
// «отдельной страницей внутри мастера»). Карточка и страница «Права» — два
// экрана стека, а черновик у них общий: выставленное на странице прав
// возвращается в карточку, и «Пригласить» уносит всё вместе с именем и почтой.
// Стек состояние между экранами не передаёт — поэтому черновик живёт здесь, а
// экраны на него подписаны.

export interface MasterDraftState {
  /** Календарь, из «Мастеров» которого пришли. */
  teamId: string | null;
  draft: MasterDraft;
}

let state: MasterDraftState | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Открыть черновик. Тот же календарь — продолжаем набранное; другой —
 *  начинаем заново: черновик одного календаря в другой не переносится.
 *  Без оповещения: открывает сама карточка, до подписки на черновик. */
export function openMasterDraft(teamId: string | null): MasterDraftState {
  if (state && state.teamId === teamId) return state;
  state = { teamId, draft: emptyMasterDraft(teamId) };
  return state;
}

export function updateMasterDraft(change: (draft: MasterDraft) => MasterDraft): void {
  if (!state) return;
  state = { ...state, draft: change(state.draft) };
  emit();
}

/** Ушли из карточки или пригласили — черновика больше нет. */
export function closeMasterDraft(): void {
  if (!state) return;
  state = null;
  emit();
}

export function readMasterDraft(): MasterDraftState | null {
  return state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useMasterDraft(): MasterDraftState | null {
  return useSyncExternalStore(subscribe, readMasterDraft, readMasterDraft);
}
