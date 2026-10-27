// Device-local reminders: the bell on one record («себе») and the automatic
// per-team reminder about every record (`auto:`).
import type { Appointment } from "@babun/shared/local/appointments";
import { getStorage } from "@babun/shared/storage";
import { readTeamNotifyPrefs } from "@/lib/notification-prefs-cache";
import { AUTO_REMINDER_HORIZON_MS } from "@/lib/notification-prefs";
import {
  selfReminderInstant,
  selfReminderLabel,
  type SelfReminder,
} from "@/lib/reminder-time";
import {
  removeBabunNotificationOwners,
  replaceBabunNotificationOwner,
  replaceBabunNotificationScope,
  type BabunNotificationOwnerDrafts,
} from "@/lib/notifications";
import { legacyOwners, notificationDrafts, ownersOf, type ReminderResult } from "./shared";

// ── НАПОМИНАНИЕ СЕБЕ (колокольчик в шапке записи и события) ──
//
// ЛИЧНОЕ И ЛОКАЛЬНОЕ: «пуш для себя». Правило лежит в памяти ЭТОГО телефона,
// а не в записи: в записи его увидели бы все устройства команды, и пуш пришёл
// бы каждому мастеру. Хранится СМЕЩЕНИЕ, момент пересчитывается от даты и
// времени записи при каждой сверке — перенесли запись, пуш переехал; запись
// удалили или отменили — пуш снят (своя группа уведомлений `self:`).

const SELF_REMINDERS_KEY = "calendar.selfReminders.v1";
const selfOwnerKey = (tenantId: string, appointmentId: string) =>
  `self:${tenantId}:${appointmentId}`;

function readSelfReminders(): Record<string, SelfReminder> {
  return getStorage().get<Record<string, SelfReminder>>(SELF_REMINDERS_KEY) ?? {};
}

function writeSelfReminders(next: Record<string, SelfReminder>): void {
  getStorage().set(SELF_REMINDERS_KEY, next);
}

/** Правило напоминания себе у этой записи на этом телефоне. */
export function getSelfReminder(appointmentId: string): SelfReminder | null {
  return readSelfReminders()[appointmentId] ?? null;
}

/** Поставить (или снять — `rule = null`) напоминание себе и сразу
 *  запланировать пуш. Разрешение на уведомления спрашивается здесь: это
 *  явное действие человека. */
export async function setSelfReminder(
  apt: Appointment,
  rule: SelfReminder | null,
  timeZone: string,
  tenantId: string,
  clientName?: string,
): Promise<ReminderResult | "cleared"> {
  const all = { ...readSelfReminders() };
  const ownerKey = selfOwnerKey(tenantId, apt.id);
  // Ключи этой записи прежнего вида — снять, чтобы не зазвонило дважды.
  const stale = ownersOf("self:", apt.id).filter((key) => key !== ownerKey);
  if (!rule) {
    delete all[apt.id];
    writeSelfReminders(all);
    await removeBabunNotificationOwners([ownerKey, ...stale]);
    return "cleared";
  }
  if (stale.length > 0) await removeBabunNotificationOwners(stale);
  all[apt.id] = rule;
  writeSelfReminders(all);
  // У записи с колокольчиком звонит колокольчик — автонапоминание снимаем
  // сразу, а не на следующей сверке календаря.
  const autos = autoOwnersOf(apt.id);
  if (autos.length > 0) await removeBabunNotificationOwners(autos);
  // ПРАВИЛО, КОТОРОЕ НЕ ЗАЗВОНИТ, НЕ ХРАНИТСЯ: сохранённое при прошедшем времени,
  // сбое или запрете уведомлений, оно показывалось бы горящим колокольчиком, хотя
  // пуша не будет, а повторный тап его СНИМАЛ бы вместо того, чтобы поставить
  // заново. Очередь iPhone — другое: правило зазвонит, когда освободится место.
  const forget = () => {
    const current = { ...readSelfReminders() };
    delete current[apt.id];
    writeSelfReminders(current);
  };
  let when: Date;
  try {
    when = selfReminderInstant(apt, rule, timeZone);
  } catch {
    forget();
    return "unavailable";
  }
  if (when.getTime() <= Date.now()) {
    forget();
    await removeBabunNotificationOwners([ownerKey]);
    return "past";
  }
  try {
    const result = await replaceBabunNotificationOwner(
      ownerKey,
      notificationDrafts(
        apt,
        [{ when, label: selfReminderLabel(rule), date: apt.date }],
        clientName,
        ownerKey,
      ),
      { requestPermission: true },
    );
    if (result.status === "capacity" || result.status === "unavailable" || result.status === "denied") {
      forget();
    }
    return result.status;
  } catch {
    forget();
    return "unavailable";
  }
}

/** Пересобрать все пуши «себе» по свежему списку записей (без запроса
 *  разрешения). Правила записей, которых нет в списке, не трогаем — список
 *  календаря бывает неполным; их пуши уходят вместе с группой и вернутся при
 *  следующей сверке, когда запись снова загрузится. */
export async function reconcileSelfReminders(
  appointments: readonly Appointment[],
  timeZoneFor: (appointment: Appointment) => string,
  tenantId: string,
  clientNameFor?: (appointment: Appointment) => string | undefined,
): Promise<void> {
  const rules = readSelfReminders();
  const owners: BabunNotificationOwnerDrafts[] = [];
  const now = Date.now();
  for (const apt of appointments) {
    const rule = rules[apt.id];
    if (!rule || apt.status === "cancelled") continue;
    let when: Date;
    try {
      when = selfReminderInstant(apt, rule, timeZoneFor(apt));
    } catch {
      continue;
    }
    if (when.getTime() <= now) continue;
    const ownerKey = selfOwnerKey(tenantId, apt.id);
    owners.push({
      ownerKey,
      drafts: notificationDrafts(
        apt,
        [{ when, label: selfReminderLabel(rule), date: apt.date }],
        clientNameFor?.(apt),
        ownerKey,
      ),
    });
  }
  await replaceBabunNotificationScope(`self:${tenantId}:`, owners, { requestPermission: false });
  const legacy = legacyOwners("self:", new Set(appointments.map((apt) => apt.id)));
  if (legacy.length > 0) await removeBabunNotificationOwners(legacy);
}

/** Снять напоминание себе по id записи (страница «Уведомления»): запись
 *  может быть не загружена, поэтому без неё — правило и пуш уходят сразу. */
export async function clearSelfReminder(appointmentId: string): Promise<void> {
  const all = { ...readSelfReminders() };
  delete all[appointmentId];
  writeSelfReminders(all);
  await removeBabunNotificationOwners(ownersOf("self:", appointmentId));
}

// ── НАПОМИНАНИЕ О КАЖДОЙ ЗАПИСИ (Кабинет → Уведомления) ──
//
// Правило — у команды записи (`team_notification_prefs`: уведомления
// чётко на эту команду), группа `auto:`. Ставится только записям (не
// событиям), не отменённым, в ближайшие две недели. У записи с колокольчиком
// звонит колокольчик — два пуша об одном не нужны. Везде выключено — группа
// пустеет.

// Ключ — с аккаунтом: сверка видит записи только
// открытого аккаунта, и замена всей группы `auto:` стирала напоминания своих
// команд, пока человек смотрел команду другого аккаунта.
const autoOwnerKey = (tenantId: string, appointmentId: string) => `auto:${tenantId}:${appointmentId}`;

/** Ключи `auto:` этой записи (любого аккаунта) — снять, когда на запись
 *  ставят колокольчик: два пуша об одном не нужны. */
function autoOwnersOf(appointmentId: string): string[] {
  return ownersOf("auto:", appointmentId);
}

export async function reconcileAutoReminders(
  appointments: readonly Appointment[],
  timeZoneFor: (appointment: Appointment) => string,
  clientNameFor: ((appointment: Appointment) => string | undefined) | undefined,
  tenantId: string,
): Promise<void> {
  const owners: BabunNotificationOwnerDrafts[] = [];
  {
    const selfRules = readSelfReminders();
    const now = Date.now();
    for (const apt of appointments) {
      if (apt.kind === "event" || apt.kind === "personal") continue;
      const rule = readTeamNotifyPrefs(apt.team_id).records;
      if (!rule) continue;
      if (apt.status === "cancelled" || apt.status === "completed") continue;
      if (selfRules[apt.id]) continue;
      let when: Date;
      try {
        when = selfReminderInstant(apt, rule, timeZoneFor(apt));
      } catch {
        continue;
      }
      const at = when.getTime();
      if (at <= now || at > now + AUTO_REMINDER_HORIZON_MS) continue;
      const ownerKey = autoOwnerKey(tenantId, apt.id);
      owners.push({
        ownerKey,
        drafts: notificationDrafts(
          apt,
          [{ when, label: selfReminderLabel(rule), date: apt.date }],
          clientNameFor?.(apt),
          ownerKey,
        ),
      });
    }
  }
  await replaceBabunNotificationScope(`auto:${tenantId}:`, owners, { requestPermission: false });
  // Ключи первого дня (`auto:<запись>` без аккаунта) — снять.
  const legacy = legacyOwners("auto:");
  if (legacy.length > 0) await removeBabunNotificationOwners(legacy);
}
