// СНИМОК ЭКРАНА СЧЕТОВ — «ЧИТАТЬ МОЖНО ВСЕГДА» (ТЗ §8).
//
// Счета, остатки и команды приезжают из сети. Без связи react-query ставит
// такой запрос в `paused` и НАВСЕГДА оставляет `isPending: true` — экран денег
// показывал вечный спиннер без единого слова. Деньги смотрят в дороге, в лифте
// и в подвале у клиента, и вчерашняя цифра с честной меткой там полезнее, чем
// вертушка.
//
// Поэтому последний УСПЕШНЫЙ ответ ложится в MMKV и подставляется, пока живых
// данных нет. Снимок подписан временем и никогда не выдаётся за свежий: шапка
// печатает «Данные на 14:32 · нет сети». Записи это не касается вовсе —
// перевод без сети не проводится (§8), снимок только для чтения.
//
// ПО ТЕНАНТУ: мастер работает на две фирмы с одного телефона, и цифры одной не
// имеют права всплыть в другой. Ключ живёт под общим префиксом `babun:` —
// значит смена учётки сносит его вместе со всем остальным (auth-clear.ts).

import { useEffect, useMemo } from "react";
import { getStorage } from "@babun/shared/storage";
import { formatDateKey } from "@babun/shared/common/utils/date-utils";
import type { Team } from "@/features/reference/queries";
import type { AccountWithBalance } from "./accounts";
import { dayPhrase } from "./period";

/** Ровно то, из чего экран рисует список: счета и команды одним куском.
 *  Половина снимка и половина сервера дали бы секции «Команда удалена» у
 *  живых команд — сохраняем и подставляем только целиком. */
export interface AccountsSnapshotData {
  /** Активные и закрытые: закрытые нужны листу создания (проверка дубля). */
  accounts: AccountWithBalance[];
  /** ВСЕ команды, включая архивные: счёт живёт дольше своей команды. */
  teams: Team[];
}

interface StoredSnapshot extends AccountsSnapshotData {
  /** Когда цифры приехали с сервера (epoch ms по часам этого телефона). */
  at: number;
}

const key = (tenantId: string) => `babun:accounts:snapshot:${tenantId}`;

/** Чужая или битая запись — это «снимка нет», а не крах экрана денег. */
function loadSnapshot(tenantId: string): StoredSnapshot | null {
  try {
    const raw = getStorage().get<StoredSnapshot>(key(tenantId));
    if (
      !raw
      || typeof raw.at !== "number"
      || !Array.isArray(raw.accounts)
      || !Array.isArray(raw.teams)
    ) {
      return null;
    }
    return raw;
  } catch {
    // MMKV может быть ещё не открыта (Keychain прогревается) — снимок это
    // удобство, ронять им экран нельзя.
    return null;
  }
}

function saveSnapshot(tenantId: string, data: AccountsSnapshotData): void {
  try {
    getStorage().set<StoredSnapshot>(key(tenantId), { ...data, at: Date.now() });
  } catch {
    // Кэш и только кэш: живые данные на экране уже есть.
  }
}

export interface AccountsView {
  /** Что рисовать. `null` — на этом устройстве счетов ещё не видели. */
  data: AccountsSnapshotData | null;
  /** Момент снимка, если рисуем ЕГО. `null` — данные живые, метки нет. */
  at: number | null;
}

/**
 * Живые данные, а пока их нет — последний снимок этого тенанта.
 *
 * `live` передаётся ТОЛЬКО целиком (обе половины экрана приехали) и должен
 * быть мемоизирован вызывающей стороной: его смена — это событие записи.
 */
export function useAccountsSnapshot(
  tenantId: string | null,
  live: AccountsSnapshotData | null,
): AccountsView {
  // Читаем один раз на тенанта: разбирать JSON на каждый кадр скролла — это
  // ровно тот подтормаживающий экран, ради которого снимок и заводился.
  const stored = useMemo(
    () => (tenantId ? loadSnapshot(tenantId) : null),
    [tenantId],
  );
  useEffect(() => {
    if (tenantId && live) saveSnapshot(tenantId, live);
  }, [tenantId, live]);

  if (live) return { data: live, at: null };
  return stored ? { data: stored, at: stored.at } : { data: null, at: null };
}

/**
 * Метка несвежести для шапки: «Данные на 14:32 · нет сети» (§7). Хвост про
 * сеть появляется только когда её действительно нет: со связью снимок висит
 * секунды до ответа, и врать про офлайн в этот момент нельзя.
 *
 * День дописывается, когда снимок не сегодняшний: «Данные на 9 августа,
 * 14:32». Голое «на 14:32» у позавчерашних цифр читается как «только что».
 */
export function snapshotNote(at: number, now: Date, online: boolean): string {
  const stamp = new Date(at);
  const time = `${String(stamp.getHours()).padStart(2, "0")}:${String(
    stamp.getMinutes(),
  ).padStart(2, "0")}`;
  const sameDay = formatDateKey(stamp) === formatDateKey(now);
  const when = sameDay ? time : `${dayPhrase(formatDateKey(stamp))}, ${time}`;
  return online ? `Данные на ${when}` : `Данные на ${when} · нет сети`;
}
