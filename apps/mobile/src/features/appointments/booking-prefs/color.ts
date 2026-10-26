import {
  RECORD_CANCELLED_KEY,
  RECORD_PAID_KEY,
  RECORD_PREPAID_KEY,
  type RecordColorPalette,
  type RecordColorRule,
} from "@babun/shared/local/calendar-settings";
import {
  COLOR_SITUATIONS,
  type ColorSituation,
} from "@/features/appointments/record-color";
import { useSaveTeamDesign, type TeamDesign } from "../team-design";
import { useDesignBase } from "./design-base";

// ЦВЕТ ЗАПИСИ В АВТОМАТИЧЕСКОМ РЕЖИМЕ.
//
// «Автоматически» значит «не выбирали руками», и по умолчанию оно означает
// цвет КОМАНДЫ. Для одной фирмы это правда — цвет говорит, чья
// бригада; для другой важнее, КУДА едут, и тогда день читается по меткам; а
// для третьей — ЧТО делают, и тогда день читается по услугам: цвет берёт
// первая услуга записи, та самая, что напечатана третьей строкой блока.
// Правило называется вслух и живёт в одном месте: календарь и форма красят
// запись одинаково, потому что спрашивают его.

export type AutoColorRule = RecordColorRule;

export const AUTO_COLOR_RULES: { id: AutoColorRule; label: string }[] = [
  { id: "team", label: "Цвет команды" },
  { id: "label", label: "Цвет метки" },
  { id: "service", label: "Цвет услуги" },
];

// ЦВЕТА ЗАПИСИ ЖИВУТ В КОМПАНИИ, А НЕ В ТЕЛЕФОНЕ.
//
// Правило, палитра ситуаций и запасной цвет в MMKV (без сервера) выкрасили бы
// записи по-разному на двух устройствах одного аккаунта, переустановка стирала
// бы настройку, а приглашённый сотрудник получал бы заводские цвета вместо
// настроенных.
//
// Поэтому это поля `calendar_settings` (миграция record_color_settings), и
// читаются они той же дверью, что остальные настройки компании:
// `useCalendarSettings` (сервер + офлайн-кэш + роль) и
// `useSaveCalendarSettings` (патч, только владелец). Своего кэша, своего
// ключа и своей мутации у цветов нет — второй двери к одной настройке
// не бывает.
//
// ЗАВОДСКИЕ ЗНАЧЕНИЯ ЗНАЕТ ЭКРАН, А НЕ ХРАНИЛИЩЕ. В базе `undefined` значит
// «владелец не выбирал»: только так «сбросить к заводскому» отличимо от
// «владелец выбрал ровно этот серый».

// ЗАВОДСКИЕ ЦВЕТА — ИЗ НАБОРА палитры. Цвет вне набора дал бы в настройке
// «Свой · Свой · Свой», и выбрать заводской заново было бы нельзя. Красный
// отдан ОТМЕНЕ — она должна бросаться в глаза; долг поэтому оранжевый, а
// «нет объекта» чёрный, чтобы ни один из трёх не спутался с соседом.
export const SITUATION_DEFAULTS: Record<ColorSituation, string> = {
  unpaid: "#DD6600",
  noObject: "#000000",
};

export const CANCELLED_DEFAULT = "#FF2233";
export const PAID_DEFAULT = "#009911";
// Бирюзовый: «деньги уже пошли», но не зелёный «всё оплачено».
export const PREPAID_DEFAULT = "#00BBDD";

/** Ключ строки настройки «Цвет записи»: ситуация, отмена или деньги. */
export type PaletteKey =
  | ColorSituation
  | typeof RECORD_CANCELLED_KEY
  | typeof RECORD_PAID_KEY
  | typeof RECORD_PREPAID_KEY;

const FALLBACK_DEFAULT = "#3333FF";

export type SituationPalette = Record<ColorSituation, string | null>;

function paletteWithDefaults(
  stored: RecordColorPalette | undefined,
): SituationPalette {
  const out = { ...SITUATION_DEFAULTS } as SituationPalette;
  if (!stored) return out;
  for (const def of COLOR_SITUATIONS) {
    if (def.id in stored) out[def.id] = stored[def.id] ?? null;
  }
  return out;
}

export function useAutoColorRule(teamId: string | null | undefined): AutoColorRule {
  return useDesignBase(teamId).rule;
}

export function useSituationPalette(teamId: string | null | undefined): SituationPalette {
  return paletteWithDefaults(useDesignBase(teamId).palette ?? undefined);
}

/** Цвет отменённой и оплаченной; `null` — случай не красит (отмена тогда
 *  прежняя серая, оплаченная — в обычном цвете). */
function storedOr(
  stored: RecordColorPalette | null | undefined,
  key: typeof RECORD_CANCELLED_KEY | typeof RECORD_PAID_KEY | typeof RECORD_PREPAID_KEY,
  fallback: string,
): string | null {
  return stored && key in stored ? stored[key] ?? null : fallback;
}

export function useCancelledColor(teamId: string | null | undefined): string | null {
  return storedOr(useDesignBase(teamId).palette, RECORD_CANCELLED_KEY, CANCELLED_DEFAULT);
}

export function usePaidColor(teamId: string | null | undefined): string | null {
  return storedOr(useDesignBase(teamId).palette, RECORD_PAID_KEY, PAID_DEFAULT);
}

export function usePrepaidColor(teamId: string | null | undefined): string | null {
  return storedOr(useDesignBase(teamId).palette, RECORD_PREPAID_KEY, PREPAID_DEFAULT);
}

export function useFallbackColor(teamId: string | null | undefined): string {
  return useDesignBase(teamId).fallback ?? FALLBACK_DEFAULT;
}

function useSaveDesign(teamId: string | null | undefined) {
  const base = useDesignBase(teamId);
  const save = useSaveTeamDesign();
  return {
    save,
    base,
    patch: (p: Partial<TeamDesign>) => {
      if (!teamId) return;
      save.mutate({ teamId, base, next: { ...base, ...p } });
    },
  };
}

export function useSetAutoColorRule(teamId: string | null | undefined) {
  const { save, patch } = useSaveDesign(teamId);
  return { ...save, mutate: (rule: AutoColorRule) => patch({ rule }) };
}

export function useSetSituationColor(teamId: string | null | undefined) {
  const { save, base, patch } = useSaveDesign(teamId);
  return {
    ...save,
    // Патч цвета ОДНОЙ ситуации переписывает палитру целиком — основа то, что
    // на экране (с заводскими), иначе первая правка стёрла бы соседние.
    mutate: (input: { situation: PaletteKey; color: string | null }) => {
      const stored = base.palette;
      patch({
        palette: {
          ...paletteWithDefaults(stored ?? undefined),
          [RECORD_CANCELLED_KEY]: storedOr(stored, RECORD_CANCELLED_KEY, CANCELLED_DEFAULT),
          [RECORD_PAID_KEY]: storedOr(stored, RECORD_PAID_KEY, PAID_DEFAULT),
          [RECORD_PREPAID_KEY]: storedOr(stored, RECORD_PREPAID_KEY, PREPAID_DEFAULT),
          [input.situation]: input.color,
        },
      });
    },
  };
}
