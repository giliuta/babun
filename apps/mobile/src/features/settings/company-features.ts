import { useQuery } from "@tanstack/react-query";
import {
  isFeatureOn,
  withFeature,
  type CompanyFeatureKey,
} from "@babun/shared/local/company-features";
import { useScopeCompany } from "@/features/clients/company-scope";
import { calendarSettingsQueryKey } from "@/lib/company-query-keys";

import { fetchCalendarSettings } from "./company-fetchers";
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

/** Выключенные функции компании ЭКРАНА КЛИЕНТОВ (03.10): у строки
 *  работодателя в общем списке и у карточки с `?tenant=` — ЕГО компании, а не
 *  открытой в календаре (`useScopeCompany`). «Поделиться» его клиентом брал
 *  реквизиты по выключателю своей компании. Чужая читается привязанным
 *  клиентом под тем же ключом, что греет прогрев, и на диск не ложится; пока
 *  едет — пусто, как и у своей. Своя и вне вкладки — `useDisabledFeatures`. */
export function useScopeDisabledFeatures(): readonly CompanyFeatureKey[] {
  const active = useDisabledFeatures();
  const { tenantId, client, role, foreign } = useScopeCompany();
  const scoped = useQuery({
    // Ключ своей компании не берём: его ведёт `useCalendarSettings` со своим
    // запасным кэшем и записью на диск.
    queryKey: calendarSettingsQueryKey(foreign ? tenantId : null, role),
    enabled: foreign && !!tenantId && role != null,
    networkMode: "always",
    staleTime: 60_000,
    queryFn: () => fetchCalendarSettings(client, tenantId as string, role as NonNullable<typeof role>),
  });
  return foreign ? (scoped.data?.disabledFeatures ?? []) : active;
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
    mutate: (
      input: { key: CompanyFeatureKey; on: boolean },
      // Сбой тумблера говорит словами у вызывающего (аудит 2026-09-30).
      options?: { onError?: (error: unknown) => void },
    ) =>
      save.mutate(
        {
          disabledFeatures: withFeature(settings.data?.disabledFeatures, input.key, input.on),
        },
        options?.onError ? { onError: options.onError } : undefined,
      ),
  };
}
