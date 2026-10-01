import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { getStorage } from "@babun/shared/storage";
import { tenantPrefKey } from "@/lib/tenant-prefs";
import { useTenantId } from "@/lib/tenant";
import { useClientsScopeOrNull } from "@/features/clients/company-scope";
import { useDesignBase } from "@/features/appointments/booking-prefs";
import {
  useSaveTeamDesign,
  useTeamDesign,
  useTeamDesigns,
} from "@/features/appointments/team-design";

// Волна 2 — «Что показывать на карточке» (v811). Зеркало web
// lib/client-card-prefs.ts: web хранит в localStorage → на мобиле тот же
// ключ через KVStorage-seam (MMKV, device-local — как web, без синка).
// Дефолт-мердж при чтении: объект от старой сборки не может скрыть
// новое поле.

// ДЕНЕГ В СТРОКЕ НЕТ (владелец 01.10: «уберём полностью этот блок — долг,
// доход, ожидается — со страницы клиентов»). Они остаются на странице клиента.
export type CardField = "phone" | "last" | "meta";

export type CardFieldPrefs = Record<CardField, boolean>;

const CARD_FIELDS: CardField[] = ["phone", "last", "meta"];

/** Всё видно по умолчанию — карточка до появления тогглов. */
export const DEFAULT_CARD_FIELDS: CardFieldPrefs = {
  // Владелец 2026-08-06: «хочу, чтоб сразу было видно номер телефона».
  phone: true,
  last: true,
  meta: true,
};

// Тот же ключ, что и web (localStorage) — единая конвенция `babun-…`.
const KEY = "babun-client-card-fields";

// У КАЖДОЙ КОМАНДЫ СВОЙ НАБОР (владелец 30.09). Ключ команды называет
// компанию (`tenantPrefKey`) — такой переживает переход в другую компанию и
// возвращение. Команда, которая ещё ничего не меняла, живёт общим набором:
// нынешняя настройка не пропадает.
const teamKey = (teamId: string, tenantId: string) =>
  tenantPrefKey(`clients.card-fields.team.${teamId}`, tenantId);

/** Компания набора — как у способов связи: вкладка «Клиенты» открыта в своей
 *  компании даже при чужом календаре. */
function usePrefsTenantId(): string | null {
  const scope = useClientsScopeOrNull();
  const activeTenantId = useTenantId();
  return scope?.tenantId ?? activeTenantId;
}

function getCardFields(
  teamId: string | null = null,
  tenantId: string | null = null,
): CardFieldPrefs {
  try {
    const storage = getStorage();
    const parsed =
      (teamId && tenantId
        ? storage.get<Partial<CardFieldPrefs>>(teamKey(teamId, tenantId))
        : undefined) ?? storage.get<Partial<CardFieldPrefs>>(KEY);
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

function setCardFields(
  prefs: CardFieldPrefs,
  teamId: string | null = null,
  tenantId: string | null = null,
): void {
  try {
    getStorage().set(teamId && tenantId ? teamKey(teamId, tenantId) : KEY, prefs);
  } catch {
    // Запись best-effort — падение кэша не должно ронять UI.
  }
}

const cardFieldsKey = (teamId: string | null, tenantId: string | null) =>
  ["client-card-fields", tenantId, teamId] as const;

/** НАБОР КОМАНДЫ НА СЕРВЕРЕ (`team_design.client_list_off`, 30.09): владелец
 *  настроил — у всех людей команды так же. `null` — сервер набор не хранит,
 *  тогда набор с телефона. */
function fromServerOff(off: readonly string[] | null | undefined): CardFieldPrefs | null {
  if (!off) return null;
  const out = { ...DEFAULT_CARD_FIELDS };
  for (const f of CARD_FIELDS) out[f] = !off.includes(f);
  return out;
}

/** Живые префы полей карточки команды — один query key на команду, так
 *  что тоггл в «Что показывать» мгновенно обновляет список. */
export function useCardFields(teamId: string | null = null) {
  const tenantId = usePrefsTenantId();
  const local = useQuery({
    queryKey: cardFieldsKey(teamId, tenantId),
    queryFn: () => getCardFields(teamId, tenantId),
    initialData: () => getCardFields(teamId, tenantId),
    staleTime: Infinity,
  });
  const server = fromServerOff(useTeamDesign(teamId)?.listOff);
  return { ...local, data: server ?? local.data };
}

/** Наборы нескольких команд разом — строки списка берут набор СВОЕЙ команды
 *  клиента. Ключи те же, что у `useCardFields`, поэтому тоггл в настройках
 *  доходит до списка сразу. */
export function useCardFieldsByTeam(teamIds: readonly string[]) {
  const tenantId = usePrefsTenantId();
  const results = useQueries({
    queries: teamIds.map((teamId) => ({
      queryKey: cardFieldsKey(teamId, tenantId),
      queryFn: () => getCardFields(teamId, tenantId),
      initialData: () => getCardFields(teamId, tenantId),
      staleTime: Infinity,
    })),
  });
  const shared = useCardFields(null).data;
  const { data: designs } = useTeamDesigns();
  const byTeam = new Map<string, CardFieldPrefs>();
  teamIds.forEach((teamId, i) => {
    const data = fromServerOff(designs?.[teamId]?.listOff) ?? results[i]?.data;
    if (data) byTeam.set(teamId, data);
  });
  return (teamId: string | null | undefined): CardFieldPrefs =>
    (teamId ? byTeam.get(teamId) : undefined) ?? shared;
}

export function useToggleCardField(teamId: string | null = null) {
  const qc = useQueryClient();
  const tenantId = usePrefsTenantId();
  const current = useCardFields(teamId).data;
  const base = useDesignBase(teamId);
  const saveTeam = useSaveTeamDesign();
  const local = useMutation({
    // Локальная запись (MMKV) — не должна ждать сети.
    networkMode: "always",
    mutationFn: async (field: CardField) => {
      const next = { ...getCardFields(teamId, tenantId) };
      next[field] = !next[field];
      setCardFields(next, teamId, tenantId);
      return next;
    },
    onSuccess: (next) => qc.setQueryData(cardFieldsKey(teamId, tenantId), next),
  });
  return {
    isPending: local.isPending || saveTeam.isPending,
    mutate: (field: CardField) => {
      // Без команды — прежний набор телефона.
      if (!teamId) return local.mutate(field);
      // У команды — на сервер: с текущим набором (сервер или телефон) и правкой.
      const next = { ...current, [field]: !current[field] };
      saveTeam.mutate({
        teamId,
        next: { ...base, listOff: CARD_FIELDS.filter((f) => !next[f]) },
      });
    },
  };
}

/** Краткое живое резюме включённых полей (строка в настройках, web
 *  cardSummary). */
export function cardFieldsSummary(p: CardFieldPrefs): string {
  const parts = ["Имя"];
  if (p.phone) parts.push("телефон");
  if (p.last) parts.push("посл. запись");
  if (p.meta) parts.push("команда/метка/теги");
  return parts.join(" · ");
}
