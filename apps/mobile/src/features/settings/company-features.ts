import {
  isFeatureOn,
  withFeature,
  type CompanyFeatureKey,
} from "@babun/shared/local/company-features";

import { useCalendarSettings, useSaveCalendarSettings } from "./local-settings";

// ФУНКЦИИ КОМПАНИИ НА ЭКРАНЕ (STORY-088). Читаются той же дверью, что
// остальные настройки компании (`useCalendarSettings`: сервер + кэш телефона,
// владелец и сотрудник), пишутся тем же патчем (`useSaveCalendarSettings`,
// только владелец). Своего кэша и своей мутации у функций нет — второй двери
// к одной настройке не бывает.

/** Выключенные функции компании. Пока настройки не пришли — пусто: лучше
 *  на миг показать блок, чем спрятать то, что у компании включено. */
export function useDisabledFeatures(): readonly CompanyFeatureKey[] {
  return useCalendarSettings().data?.disabledFeatures ?? [];
}

/** Включена ли функция в компании. Выключенная прячется у ВСЕХ, у
 *  владельца тоже (владелец 24.09). */
export function useFeatureOn(key: CompanyFeatureKey): boolean {
  return isFeatureOn(useDisabledFeatures(), key);
}

/** Переключить функцию (только владелец — сервер откажет остальным). */
export function useSetCompanyFeature() {
  const settings = useCalendarSettings();
  const save = useSaveCalendarSettings();
  return {
    ...save,
    mutate: (input: { key: CompanyFeatureKey; on: boolean }) =>
      save.mutate({
        disabledFeatures: withFeature(settings.data?.disabledFeatures, input.key, input.on),
      }),
  };
}
