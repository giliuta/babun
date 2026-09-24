import { useSyncExternalStore } from "react";

import { STARTER_CALENDAR_LEVELS, emptyMasterDraft, type MasterDraft } from "./master-draft";

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
  /** Приглашение ПО СУЩЕСТВУЮЩЕЙ карточке мастера без аккаунта (STORY-087):
   *  после ответа человек входит уже со своей карточкой и календарём. */
  masterId?: string | null;
  /** Начало черновика по карточке: с ним сравнивается «грязность». */
  baseline?: MasterDraft;
}

let state: MasterDraftState | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Открыть черновик. Тот же календарь — продолжаем набранное; другой —
 *  начинаем заново: черновик одного календаря в другой не переносится.
 *  Без оповещения: открывает сама карточка, до подписки на черновик. */
export function openMasterDraft(
  teamId: string | null,
  cardId: string | null = null,
): MasterDraftState {
  // Черновик по карточке и черновик нового мастера — разные: «Новый мастер»
  // после «Пригласить в CRM» не должен звать чужую карточку.
  if (state && state.teamId === teamId && (state.masterId ?? null) === cardId) return state;
  state = { teamId, draft: emptyMasterDraft(teamId) };
  return state;
}

/** Черновик приглашения по карточке без аккаунта: имя, телефон и календари
 *  уже известны — остаётся почта и права. */
export function openMasterDraftFromCard(card: {
  teamId: string | null;
  masterId: string;
  name: string;
  phone: string;
  teamIds: readonly string[];
}): MasterDraftState {
  const base = emptyMasterDraft(card.teamId);
  const teamIds = card.teamIds.length > 0 ? [...card.teamIds] : base.teamIds;
  const draft: MasterDraft = {
    ...base,
    name: card.name,
    phone: card.phone,
    teamIds,
    // Стартовые права — в каждом календаре карточки, а не только в первом.
    calendarLevels: Object.fromEntries(teamIds.map((id) => [id, { ...STARTER_CALENDAR_LEVELS }])),
  };
  state = { teamId: card.teamId, masterId: card.masterId, draft, baseline: draft };
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
