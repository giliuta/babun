import { Linking } from "react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Client } from "@babun/shared/local/clients";
import { buildMapUrl, type MapService } from "@babun/shared/common/utils/map-links";
import { getActiveTenantId } from "@/lib/active-tenant";
import { queryClient } from "@/lib/query-client";
import { getNotificationsModule } from "@/lib/notifications";
import { readMapServicesNow } from "@/features/clients/map-services";
import { directRouteUrl, routeTarget } from "@/features/clients/route-menu";
import { APPOINTMENT_CATEGORY, CANCEL_CATEGORY, type PushAction } from "./push-action-ids";

// КНОПКИ В УВЕДОМЛЕНИИ О ЗАПИСИ.
//
// Пуш сервера (`push_activity`) приходит с категорией: о новой и
// перенесённой работе — «Открыть · Позвонить клиенту · Маршрут», об отмене —
// «Открыть день». Категории — штатный механизм `expo-notifications`, нового
// нативного кода нет; приложение заводит их при входе.
//
// Кнопка открывает приложение (иначе ни позвонить, ни проложить маршрут) и
// работает по уже загруженным записям и клиентам, перечитанным перед этим
// (`refreshAppointmentsForTap`). Права соблюдаются сами: номер сотруднику
// приходит по одному, и в общем списке его нет — тогда кнопка открывает
// запись, где номер показывает канонический путь.


/** Завести категории. Подписи — на языке интерфейса этого запуска. */
export async function registerPushCategories(): Promise<void> {
  const Notifications = getNotificationsModule();
  if (!Notifications) return;
  const opens = { opensAppToForeground: true };
  // ПО ОЧЕРЕДИ, НЕ РАЗОМ: iOS хранит категории одним набором, и два
  // одновременных вызова перезаписывают друг друга — вторая категория
  // пропадала.
  try {
    await Notifications.setNotificationCategoryAsync(APPOINTMENT_CATEGORY, [
      { identifier: "open", buttonTitle: "Открыть", options: opens },
      { identifier: "call", buttonTitle: "Позвонить клиенту", options: opens },
      { identifier: "route", buttonTitle: "Маршрут", options: opens },
    ]);
    await Notifications.setNotificationCategoryAsync(CANCEL_CATEGORY, [
      { identifier: "open-day", buttonTitle: "Открыть день", options: opens },
    ]);
  } catch {
    // Сборка без категорий — уведомление приходит без кнопок.
  }
}

function cached<T>(prefix: string): T[] {
  const tenantId = getActiveTenantId();
  if (!tenantId) return [];
  return queryClient
    .getQueriesData<T[]>({ queryKey: [prefix, tenantId] })
    .flatMap(([, data]) => (Array.isArray(data) ? data : []));
}

/** Номер и цель маршрута записи — из загруженного; `null` — не знаем. */
export function recordContacts(
  appointmentId: string,
  appointments: readonly Appointment[],
  clients: readonly Client[],
): { phone: string | null; route: string | null } {
  const appointment = appointments.find((a) => a.id === appointmentId);
  if (!appointment) return { phone: null, route: null };
  const client = appointment.client_id ? clients.find((c) => c.id === appointment.client_id) : undefined;
  const location = appointment.location_id
    ? client?.locations?.find((l) => l.id === appointment.location_id)
    : undefined;
  const phone = (client?.phone ?? "").replace(/[^+\d]/g, "");
  const route = routeTarget(location?.mapUrl, appointment.address || location?.address || client?.address);
  return { phone: phone || null, route: route || null };
}

/** Карта для маршрута из уведомления: выбора здесь нет (листа над
 *  уведомлением не показать), поэтому — первая из карт команды по порядку. */
export function routeUrlFor(target: string, enabled: MapService[]): string | null {
  return directRouteUrl(target, enabled) ?? (enabled[0] ? buildMapUrl(enabled[0], target) : null);
}

/** Выполнить «Позвонить клиенту» или «Маршрут». `false` — данных нет,
 *  вызывающий открывает запись. */
export function runPushAction(action: PushAction, appointmentId: string, teamId: string | null): boolean {
  if (action === "day") return false;
  const { phone, route } = recordContacts(appointmentId, cached<Appointment>("appointments"), cached<Client>("clients"));
  if (action === "call" && phone) {
    void Linking.openURL(`tel:${phone}`);
    return true;
  }
  if (action === "route" && route) {
    const url = routeUrlFor(route, readMapServicesNow(getActiveTenantId(), teamId));
    if (url) {
      void Linking.openURL(url);
      return true;
    }
  }
  return false;
}
