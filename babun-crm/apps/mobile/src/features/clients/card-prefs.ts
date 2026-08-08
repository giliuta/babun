import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getStorage } from "@babun/shared/storage";

// Волна 2 — «Что показывать на карточке» (v811). Зеркало web
// lib/client-card-prefs.ts: web хранит в localStorage → на мобиле тот же
// ключ через KVStorage-seam (MMKV, device-local — как web, без синка).
// Дефолт-мердж при чтении: объект от старой сборки не может скрыть
// новое поле.

export type CardField = "phone" | "exp" | "inc" | "debt" | "last" | "meta";

export type CardFieldPrefs = Record<CardField, boolean>;

export const CARD_FIELDS: CardField[] = [
  "phone",
  "exp",
  "inc",
  "debt",
  "last",
  "meta",
];

/** Всё видно по умолчанию — карточка до появления тогглов. */
export const DEFAULT_CARD_FIELDS: CardFieldPrefs = {
  // Владелец 2026-08-06: «хочу, чтоб сразу было видно номер телефона».
  phone: true,
  exp: true,
  inc: true,
  debt: true,
  last: true,
  meta: true,
};

// Тот же ключ, что и web (localStorage) — единая конвенция `babun-…`.
const KEY = "babun-client-card-fields";

export function getCardFields(): CardFieldPrefs {
  try {
    const parsed = getStorage().get<Partial<CardFieldPrefs>>(KEY);
    if (!parsed) return { ...DEFAULT_CARD_FIELDS };
    const out = { ...DEFAULT_CARD_FIELDS };
    for (const f of CARD_FIELDS) {
      if (typeof parsed[f] === "boolean") out[f] = parsed[f] as boolean;
    }
    return out;
  } catch {
    // Storage seam ещё не инициализирован / повреждённое значение.
    return { ...DEFAULT_CARD_FIELDS };
  }
}

export function setCardFields(prefs: CardFieldPrefs): void {
  try {
    getStorage().set(KEY, prefs);
  } catch {
    // Запись best-effort — падение кэша не должно ронять UI.
  }
}

/** Живые префы полей карточки — один query key на все экраны, так что
 *  тоггл в «Что показывать» мгновенно обновляет список. */
export function useCardFields() {
  return useQuery({
    queryKey: ["client-card-fields"],
    queryFn: () => getCardFields(),
    staleTime: Infinity,
  });
}

export function useToggleCardField() {
  const qc = useQueryClient();
  return useMutation({
    // Локальная запись (MMKV) — не должна ждать сети.
    networkMode: "always",
    mutationFn: async (field: CardField) => {
      const next = { ...getCardFields() };
      next[field] = !next[field];
      setCardFields(next);
      return next;
    },
    onSuccess: (next) => qc.setQueryData(["client-card-fields"], next),
  });
}

/** Краткое живое резюме включённых полей (строка в настройках, web
 *  cardSummary). */
export function cardFieldsSummary(p: CardFieldPrefs): string {
  const parts = ["Имя"];
  if (p.phone) parts.push("телефон");
  if (p.exp) parts.push("ожид. прибыль");
  if (p.inc) parts.push("доход");
  if (p.debt) parts.push("долг");
  if (p.last) parts.push("посл. запись");
  if (p.meta) parts.push("команда/метка/теги");
  return parts.join(" · ");
}
