import { readTenantPref } from "@/lib/tenant-prefs";
import { useTenantId } from "@/lib/tenant";
import { useCalendarVisibility } from "@/session/workspaces";
import { pickDefaultTeamId, type TeamRef } from "./default-team-rule";

// КАКУЮ КОМАНДУ ЭКРАН НАСТРОЕК ОТКРЫВАЕТ, ПОКА ЧИП НЕ ТРОНУЛИ.
//
// Экраны с лентой команд («Настройки клиентов», «Уведомления») брали первую
// команду справочника — а первой бывает скрытый календарь. Человек его не
// видит нигде, кроме шестерёнки, и попадал в его настройки: «Тегов пока нет»
// при четырёх тегах у команды, в которой он работает. Порядок тот же, что у
// «Настроек календаря»: календарь, открытый сейчас, → первый видимый → первый.

/** Команда по умолчанию для ленты команд экрана настроек. */
export function useDefaultTeamId(teams: readonly TeamRef[]): string | null {
  const tenantId = useTenantId();
  const { isHidden } = useCalendarVisibility();
  // Тот же ключ, которым календарь помнит открытую команду; только читаем.
  const openTeamId = tenantId
    ? readTenantPref<{ teamId?: string | null }>("calendar.view", tenantId, "calendar.view")?.teamId
    : null;
  return pickDefaultTeamId(teams, openTeamId, isHidden);
}
