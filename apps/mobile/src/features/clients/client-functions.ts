import { isFeatureOn, type CompanyFeatureKey } from "@babun/shared/local/company-features";
import { useScopeDisabledFeatures } from "@/features/settings/company-features";
import { useDesignBase } from "@/features/appointments/booking-prefs";
import { useSaveTeamDesign, useTeamDesign } from "@/features/appointments/team-design";

// ФУНКЦИИ КЛИЕНТОВ — У КОМАНДЫ (владелец 30.09: «люди, связи, реквизиты,
// файлы — всё закреплено за командой»). Ключ лежит в `team_design.disabled_blocks`
// команды. Выключатель компании (STORY-088) по-прежнему главнее: выключенное
// у компании не включит ни одна команда. К клиенту применяется команда
// клиента.

export type ClientFunctionKey =
  | "client_people"
  | "client_requisites"
  | "client_files"
  | "client_note"
  | "client_objects"
  | "client_labels"
  | "client_personal"
  | "client_tags";

/** Ключи с выключателем компании (STORY-088). У остальных блоков его нет —
 *  они выключаются только у команды. */
const COMPANY_KEYS = new Set<ClientFunctionKey>([
  "client_people",
  "client_requisites",
  "client_files",
]);

/** Включена ли функция у команды (и у компании). Без команды — как у
 *  компании. */
export function useClientFunctionOn(
  key: ClientFunctionKey,
  teamId: string | null | undefined,
): boolean {
  // Выключатель компании есть только у трёх ключей; «Заметку» и прочие
  // компания не выключает. Компания — та же, что у «Дизайна» команды ниже:
  // компания экрана (у строки работодателя — его, 03.10).
  const disabled = useScopeDisabledFeatures();
  const companyOn =
    !COMPANY_KEYS.has(key) || isFeatureOn(disabled, key as CompanyFeatureKey);
  const design = useTeamDesign(teamId);
  return companyOn && !(design?.disabledBlocks ?? []).includes(key);
}

/** Переключить функцию команды (только владелец — сервер откажет остальным). */
export function useToggleClientFunction(teamId: string | null | undefined) {
  const base = useDesignBase(teamId);
  const save = useSaveTeamDesign();
  return {
    ...save,
    mutate: (input: { key: ClientFunctionKey; on: boolean }) => {
      if (!teamId) return;
      const off = new Set(base.disabledBlocks);
      if (input.on) off.delete(input.key);
      else off.add(input.key);
      save.mutate({ teamId, base, next: { ...base, disabledBlocks: [...off] } });
    },
  };
}
