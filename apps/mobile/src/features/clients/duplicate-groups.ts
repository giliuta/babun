import type { Client } from "@babun/shared/local/clients";
import { phoneKey } from "@/features/clients/merge-clients";

// «ДУБЛИ» В НАСТРОЙКАХ КЛИЕНТОВ (владелец 30.09: «дубли тоже делай»).
//
// Плашка «Похоже, это один человек» (`DuplicateNotice`) видна только на
// открытой карточке — а кто откроет карточку, не зная, что она дубль? Здесь
// тот же ключ смотрит на всю базу разом и собирает пары.
//
// ТОЛЬКО ПО НОМЕРУ и ТЕМ ЖЕ КЛЮЧОМ, что у плашки и слияния (хвост в 8 цифр):
// страница, плашка и «⋯ → Объединить с дублем» не могут назвать дублем
// разные карточки. Две Марии с разными номерами — не дубль.
//
// У КОМАНДЫ (30.09 всё в настройках клиентов — у команды): группа видна
// команде, если в ней есть хоть одна её карточка. Пара «клиент Команды 1 +
// клиент Команды 3» видна обеим — склеить её можно из любой.

/** Короче восьми цифр ключа нет: по четырём совпадёт пол-базы. */
const KEY_DIGITS = 8;

export interface DuplicateGroup<T> {
  /** Хвост номера, общий у всех карточек группы. */
  key: string;
  /** Карточки группы: старшая первой — её обычно и оставляют. */
  clients: T[];
}

type DupClient = Pick<Client, "id" | "phone" | "created_at" | "deleted_at" | "team_id">;

/**
 * Группы живых карточек с одним номером. `teamClientIds` — карточки команды
 * (свои и обслуженные, `clientsOfTeam`); без него — вся база.
 */
export function findDuplicateGroups<T extends DupClient>(
  clients: readonly T[],
  teamClientIds?: ReadonlySet<string>,
): DuplicateGroup<T>[] {
  const byKey = new Map<string, T[]>();
  for (const c of clients) {
    if (c.deleted_at) continue;
    const key = phoneKey(c.phone);
    if (key.length < KEY_DIGITS) continue;
    const list = byKey.get(key);
    if (list) list.push(c);
    else byKey.set(key, [c]);
  }
  const groups: DuplicateGroup<T>[] = [];
  for (const [key, list] of byKey) {
    if (list.length < 2) continue;
    if (teamClientIds && !list.some((c) => teamClientIds.has(c.id))) continue;
    const sorted = [...list].sort(
      (a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "") || a.id.localeCompare(b.id),
    );
    groups.push({ key, clients: sorted });
  }
  // Свежий дубль — наверху: его только что завели, и помнят, кто это.
  const newest = (g: DuplicateGroup<T>) => g.clients[g.clients.length - 1]?.created_at ?? "";
  return groups.sort((a, b) => newest(b).localeCompare(newest(a)) || a.key.localeCompare(b.key));
}
