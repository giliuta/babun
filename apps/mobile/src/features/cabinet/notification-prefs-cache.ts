import { getStorage } from "@babun/shared/storage";
import {
  DEFAULT_TEAM_PREFS,
  prefsFromRow,
  rowFromPrefs,
  type TeamNotifyPrefs,
  type TeamNotifyRow,
} from "./notification-prefs";

// КОПИЯ НАСТРОЕК УВЕДОМЛЕНИЙ НА ТЕЛЕФОНЕ — без React и сети: её синхронно
// читают сверка напоминаний календаря, напоминание о клиенте, сторож бюджета
// и читатель событий команды (и их тесты под node). Истина — в базе
// (`notification-prefs-store.ts` пишет сюда каждое чтение и правку).

const KEY = "babun:notifications.teamPrefs.v1";

export type TeamPrefsMap = Record<string, TeamNotifyPrefs>;

const listeners = new Set<() => void>();
let cache: TeamPrefsMap | null = null;
let version = 0;

export function readTeamPrefsMap(): TeamPrefsMap {
  if (cache) return cache;
  try {
    const raw = getStorage().get<Record<string, Partial<TeamNotifyRow>>>(KEY) ?? {};
    cache = Object.fromEntries(Object.entries(raw).map(([team, row]) => [team, prefsFromRow(row)]));
  } catch {
    cache = {};
  }
  return cache;
}

export function writeTeamPrefsMap(next: TeamPrefsMap): void {
  cache = next;
  version += 1;
  try {
    getStorage().set(
      KEY,
      Object.fromEntries(Object.entries(next).map(([team, prefs]) => [team, rowFromPrefs(prefs)])),
    );
  } catch {
    // Копия best-effort: истина в базе.
  }
  for (const listener of listeners) listener();
}

/** Настройки человека в команде (синхронно, из копии). Без команды — умолчания. */
export function readTeamNotifyPrefs(teamId: string | null | undefined): TeamNotifyPrefs {
  if (!teamId) return DEFAULT_TEAM_PREFS;
  return readTeamPrefsMap()[teamId] ?? DEFAULT_TEAM_PREFS;
}

export function subscribeTeamPrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function teamPrefsVersion(): number {
  return version;
}
