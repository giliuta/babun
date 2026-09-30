import { getStorage } from "@babun/shared/storage";

// ЧИСТАЯ ЧАСТЬ НАБОРОВ «ЧТО ПРЕДЛАГАТЬ И В КАКОМ ПОРЯДКЕ» — ключи, чтение,
// правила. Без React и без React Native: её проверяют тесты
// (`enabled-prefs.test.ts`), а хуки живут в `enabled-prefs.ts`.

export interface EnabledPrefsOptions<T extends string> {
  /** Префикс ключа в MMKV; к нему приклеивается tenantId. */
  storageKey: string;
  /** Ключ кэша react-query. */
  queryKey: string;
  /** Все возможные значения в порядке ПО УМОЛЧАНИЮ. */
  all: readonly T[];
  /** Что включено, пока никто ничего не настраивал. */
  defaults: readonly T[];
  /** Всегда включены и всегда первыми; не выключаются и не двигаются. */
  pinned?: readonly T[];
  /** Нужен ли хотя бы один включённый пункт (иначе контрол умрёт). */
  requireOne?: boolean;
  /** Пункты, которые СУЩЕСТВОВАЛИ до того, как набор начал помнить, что он
   *  знает (`:known`). У устройства со старым сохранённым списком новый
   *  пункт из `defaults` иначе оказался бы выключенным молча — так 2026-09-06
   *  «Файлы» пропали бы у владельца. Не указано — считается, что старых
   *  списков с неполным набором нет. */
  legacyIds?: readonly T[];
  /** ЧТО ЗАПИСАТЬ, ЕСЛИ СВОЕГО ЕЩЁ НЕТ. Зовётся ровно один раз на тенант —
   *  когда набор объединяет два прежних (см. `contact-ways`) и молча
   *  потерять уже настроенное нельзя. `null` — переносить нечего, работают
   *  обычные `defaults`. */
  migrate?: (tenantId: string | null) => {
    enabled?: readonly T[];
    order?: readonly T[];
  } | null;
}

export function createEnabledPrefsStore<T extends string>(opts: EnabledPrefsOptions<T>) {
  const { storageKey, all, defaults, requireOne } = opts;
  const pinned = opts.pinned ?? [];
  // НАБОР У КОМАНДЫ (владелец 30.09: «у каждой команды свои настройки
  // клиентов»). Ключ команды — ключ компании плюс `:team:<id>`. Команда,
  // которая ещё ничего не меняла, живёт общим набором компании: нынешние
  // настройки не пропадают, а новая команда начинает с того, что уже есть.
  const key = (tenantId: string | null, teamId: string | null = null) => {
    const base = tenantId ? `${storageKey}:${tenantId}` : storageKey;
    return teamId ? `${base}:team:${teamId}` : base;
  };
  const orderKey = (tenantId: string | null, teamId: string | null = null) =>
    `${key(tenantId, teamId)}:order`;
  /** Какие пункты набор знал, когда список писали в последний раз. */
  const knownKey = (tenantId: string | null, teamId: string | null = null) =>
    `${key(tenantId, teamId)}:known`;
  const rememberKnown = (tenantId: string | null, teamId: string | null = null) => {
    try {
      getStorage().set(knownKey(tenantId, teamId), [...all]);
    } catch {
      // Запись best-effort.
    }
  };
  /** Своё ли у команды. Без команды — всегда «своё» (набор компании). */
  const hasOwn = (tenantId: string | null, teamId: string | null): boolean => {
    if (!teamId) return true;
    try {
      const storage = getStorage();
      // `!= null`, а не `!== undefined`: хранилище отдаёт на пустой ключ и
      // `undefined` (MMKV), и `null` — пусто оба раза.
      return (
        storage.get<string[]>(key(tenantId, teamId)) != null ||
        storage.get<string[]>(orderKey(tenantId, teamId)) != null
      );
    } catch {
      return false;
    }
  };

  /** Перенос со старых ключей — до первого чтения и только пока своего нет. */
  const ensureMigrated = (tenantId: string | null) => {
    if (!opts.migrate) return;
    try {
      const storage = getStorage();
      if (storage.get<string[]>(key(tenantId)) !== undefined) return;
      const seed = opts.migrate(tenantId);
      if (!seed) return;
      if (seed.enabled) storage.set(key(tenantId), [...seed.enabled]);
      if (seed.order) storage.set(orderKey(tenantId), [...seed.order]);
    } catch {
      // Перенос best-effort: без него набор просто встанет на умолчания.
    }
  };

  /** Полный порядок всех пунктов: закреплённые сверху, затем сохранённый
   *  порядок, затем всё, чего в нём ещё нет (новый способ связи в обновлении
   *  не должен исчезнуть только потому, что порядок сохранён раньше). */
  const readOrder = (tenantId: string | null, teamId: string | null = null): T[] => {
    if (!hasOwn(tenantId, teamId)) return readOrder(tenantId, null);
    if (!teamId) ensureMigrated(tenantId);
    let saved: T[] = [];
    try {
      const raw = getStorage().get<string[]>(orderKey(tenantId, teamId));
      if (Array.isArray(raw)) saved = raw.filter((id) => all.includes(id as T)) as T[];
    } catch {
      saved = [];
    }
    const rest = all.filter((id) => !pinned.includes(id) && !saved.includes(id));
    return [
      ...pinned,
      ...saved.filter((id) => !pinned.includes(id)),
      ...rest,
    ];
  };

  /** Включённые — В ПОРЯДКЕ ПОКАЗА. */
  const read = (tenantId: string | null, teamId: string | null = null): T[] => {
    if (!hasOwn(tenantId, teamId)) return read(tenantId, null);
    if (!teamId) ensureMigrated(tenantId);
    const order = readOrder(tenantId, teamId);
    let enabled: T[];
    try {
      const raw = getStorage().get<string[]>(key(tenantId, teamId));
      enabled = Array.isArray(raw)
        ? (raw.filter((id) => all.includes(id as T)) as T[])
        : [...defaults];
      if (enabled.length === 0 && requireOne) enabled = [...defaults];
    } catch {
      enabled = [...defaults];
    }
    // Пункт, которого набор ещё не знал, когда список сохраняли, — не
    // «выключен», а «не существовал»: включаем его, если он в `defaults`.
    let known: T[] | null = null;
    try {
      const raw = getStorage().get<string[]>(knownKey(tenantId, teamId));
      known = Array.isArray(raw) ? (raw as T[]) : null;
    } catch {
      known = null;
    }
    const baseline = known ?? opts.legacyIds ?? all;
    const introduced = defaults.filter((id) => !baseline.includes(id));
    // Закреплённое включено всегда, чем бы ни было записано раньше.
    const withPinned = [...new Set([...pinned, ...enabled, ...introduced])];
    return order.filter((id) => withPinned.includes(id));
  };

  /** Первая правка команды: сначала копия набора компании, потом правка —
   *  иначе первый же тап сбросил бы остальные пункты к умолчаниям. */
  const seedTeam = (tenantId: string | null, teamId: string | null) => {
    if (!teamId || hasOwn(tenantId, teamId)) return;
    try {
      const storage = getStorage();
      storage.set(key(tenantId, teamId), read(tenantId, null));
      storage.set(orderKey(tenantId, teamId), readOrder(tenantId, null));
      storage.set(knownKey(tenantId, teamId), [...all]);
    } catch {
      // Запись best-effort.
    }
  };

  const canDisable = (enabled: T[], id: T): boolean => {
    if (pinned.includes(id)) return false;
    return !requireOne || !enabled.includes(id) || enabled.length > 1;
  };

  /** Можно ли перетаскивать этот пункт. Закреплённый стоит первым всегда. */
  const canMove = (id: T): boolean => !pinned.includes(id);

  return {
    all,
    pinned,
    key,
    orderKey,
    rememberKnown,
    read,
    readOrder,
    seedTeam,
    canDisable,
    canMove,
  };
}
