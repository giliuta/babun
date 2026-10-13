// Query keys of the SMS cabinet and the per-card Supabase client.

import { supabase } from "@/lib/supabase";
import { tenantBoundClient } from "@/lib/tenant-bound-client";

export const smsAccountKey = (tenantId: string | null) => ["sms-account", tenantId];
export const smsHistoryKey = (tenantId: string | null) => ["sms-history", tenantId];
/** SMS записи и клиента — один префикс: после отправки перечитываются оба. */
export const smsLogKey = (tenantId: string | null) => ["sms-log", tenantId];
/** Шаблоны команд: все и одной команды — один префикс. */
export const smsTemplatesKey = (tenantId: string | null) => ["sms-team-templates", tenantId];

/** Клиент Supabase компании карточки: вкладка «Клиенты» открывает и
 *  клиентов компании-работодателя (`?tenant=`), и их SMS читаются и меняются
 *  под её заголовком, а не под активной компанией устройства. */
export function clientOf(cardTenantId: string | null | undefined, activeTenantId: string | null) {
  return cardTenantId && cardTenantId !== activeTenantId ? tenantBoundClient(cardTenantId) : supabase;
}
