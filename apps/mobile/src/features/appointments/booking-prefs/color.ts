import type {
  RecordColorPalette,
  RecordColorRule,
} from "@babun/shared/local/calendar-settings";
import {
  COLOR_SITUATIONS,
  type ColorSituation,
} from "@/features/appointments/record-color";
import { useSaveTeamDesign, type TeamDesign } from "../team-design";
import { useDesignBase } from "./design-base";

// ЦВЕТ ЗАПИСИ В АВТОМАТИЧЕСКОМ РЕЖИМЕ (владелец 2026-09-05: «разберём
// полноценно автоматический режим — это надо придумать в настройках и
// зафиксировать»).
//
// «Автоматически» значит «не выбирали руками», и до сих пор оно молча
// означало цвет КОМАНДЫ. Для одной фирмы это правда — цвет говорит, чья
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

// ЦВЕТА ЗАПИСИ ЖИВУТ В КОМПАНИИ, А НЕ В ТЕЛЕФОНЕ (2026-09-12).
//
// Правило, палитра ситуаций и запасной цвет лежали в MMKV — по ключам
// `babun-booking-auto-color|palette|fallback-color:<tenant>`, без сервера
// вовсе. Стоило открыть приложение на двух симуляторах владельца — ОДИН
// аккаунт, ОДНА компания, ОДИН бандл — и записи оказались выкрашены
// по-разному. Из того же корня: переустановка стирала настройку, а
// приглашённый сотрудник получал заводские цвета вместо настроенных.
//
// Теперь это поля `calendar_settings` (мигация record_color_settings), и
// читаются они той же дверью, что остальные настройки компании:
// `useCalendarSettings` (сервер + офлайн-кэш + роль) и
// `useSaveCalendarSettings` (патч, только владелец). Своего кэша, своего
// ключа и своей мутации у цветов больше нет — второй двери к одной настройке
// не бывает.
//
// ЗАВОДСКИЕ ЗНАЧЕНИЯ ЗНАЕТ ЭКРАН, А НЕ ХРАНИЛИЩЕ. В базе `undefined` значит
// «владелец не выбирал»: только так «сбросить к заводскому» отличимо от
// «владелец выбрал ровно этот серый».

// ЗАВОДСКИЕ ЦВЕТА — ИЗ НАБОРА (2026-09-24). Прежние #FF9500 / #FFCC00 /
// #005BD3 в набор не входили: в настройке стояло «Свой · Свой · Свой», выбрать
// заводской заново было нельзя, а на плотном блоке оранжевый и жёлтый
// сходились в один янтарь. Морковный и Янтарный разведены по тону и после
// затемнения блока; серого в наборе нет намеренно, он остаётся заводским
// нейтральным сигналом. 25.09: «нет клиента» и «нет услуг» сняты, «не
// оплачено» — рубиновый из набора (деньги, которые должны).
const SITUATION_DEFAULTS: Record<ColorSituation, string> = {
  unpaid: "#E8145D",
  noObject: "#DF510F",
};

const FALLBACK_DEFAULT = "#3276FB";

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
    mutate: (input: { situation: ColorSituation; color: string | null }) => {
      const current = paletteWithDefaults(base.palette ?? undefined);
      patch({ palette: { ...current, [input.situation]: input.color } });
    },
  };
}
