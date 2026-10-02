import type { CountryCode } from "libphonenumber-js";
import { useTenant } from "@/features/settings/tenant";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { useTeams } from "@/features/reference/queries";
import { countryForTeam } from "@/features/clients/team-country";

export { countryForTeam };

// КОД СТРАНЫ ПО УМОЛЧАНИЮ — ИЗ ЧАСОВОГО ПОЯСА КОМАНДЫ (владелец 02.10:
// «код страны должен браться из часового пояса команды»).
//
// Было (26.07): страна компании, «командами не получится». Теперь у команды
// свой часовой пояс (настройки календаря), а клиент — у команды; кипрская
// команда заводит клиентов с +357, греческая — с +30, ничего не
// переключая. Порядок:
//   1) пояс команды клиента (`teams.timezone`);
//   2) пояс компании (настройки календаря), если у команды своего нет;
//   3) страна компании (`tenants.country`) — если страны пояса нет среди
//      поддержанных кодов номера.
//
// Код — только ПОДСТАВКА в пустое поле: номер со своим «+» уважается как
// есть (tryToE164 читает код из самого номера).

/** Код страны для клиента команды `teamId`; без команды — по поясу
 *  компании. Пока профиль не загрузился — дефолт продукта: поле ввода не
 *  должно ждать сети, чтобы показать «+357». */
export function useDefaultCountry(teamId?: string | null): CountryCode {
  const { data: tenant } = useTenant();
  const { data: settings } = useCalendarSettings();
  const { data: teams } = useTeams();
  const team = teamId ? teams?.find((row) => row.id === teamId) : undefined;
  return countryForTeam({
    teamZone: team?.timezone ?? null,
    companyZone: settings?.timezone ?? null,
    tenantCountry: tenant?.country,
  });
}
